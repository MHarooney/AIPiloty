"""AIPiloty — FastAPI application factory."""

from __future__ import annotations

import asyncio
import logging
from contextlib import asynccontextmanager
from typing import Any, Dict

from fastapi import FastAPI, Request as _Request
from fastapi.responses import JSONResponse as _JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from .middleware.rate_limit import RateLimitMiddleware
from .middleware.audit import AuditMiddleware
from .middleware.request_id import RequestIDMiddleware
from .middleware.body_size import BodySizeLimitMiddleware
from .services.scheduler import create_default_scheduler

from sqlalchemy import select

from .core.config import get_settings
from .core.database import async_session_factory, init_db
from .models.vm import VMCredential
from .services.agent.guardrails import GuardrailService
from .services.agent.memory import AgentMemory
from .services.agent.orchestrator import AgentOrchestrator
from .services.llm.ollama_service import OllamaService
from .services.ssh.executor import SSHExecutor
from .services.tools.documents.generator_service import DocumentGeneratorService
from .services.tools.documents.tools import (
    GenerateDOCX,
    GenerateImage,
    GeneratePDF,
    GeneratePPTX,
    GenerateXLSX,
)
from .services.tools.devops.tools import SSHCommandTool, VMHealthTool
from .services.tools.devops.diagnose_vm import DiagnoseVMTool
from .services.tools.host.diagnostics import HostEnvironmentTool
from .services.tools.host.ollama_status import OllamaModelStatusTool
from .services.tools.host.list_path import ListHostPathTool
from .services.tools.host.terminal import TerminalCommandTool
from .services.tools.host.sandbox_terminal import SandboxedTerminalTool
from .services.tools.knowledge_search import KnowledgeSearchTool
from .services.tools.web import FetchUrlTool
from .services.tools.research.web_search import WebSearchTool
from .services.tools.planning.create_plan import CreatePlanTool
from .services.tools.platform_stats import GetPlatformStatsTool
from .services.tools.code.workspace_tools import WriteFileTool, ApplyPatchTool
from .services.tools.registry import ToolRegistry
from .services.tools.testing.api_tools import ProbeApiTargetTool, RunApiTestsTool, AnalyzeTestFailuresTool
from .services.tools.testing.local_tools import RunLocalPytestTool, GenerateTestCodeTool
from .services.tools.testing.browser_tools import (
    BrowserNavigateTool,
    BrowserScreenshotTool,
    BrowserFillFormTool,
    BrowserClickTool,
    BrowserEvaluateTool,
    BrowserPageMapTool,
    DiscoverPlatformTool,
)
from .services.tools.mcp_configure import ConfigureMCPTool
from .services.agent.testing_orchestrator import TestingOrchestrator
from .services.rag import EmbeddingService, QdrantStore, RetrieverService, IngestService, TextChunker
from .services.rag.corrective import CorrectiveRetriever
from .services.rag.chunker_code import ASTChunker
from .services.rag.raptor import RaptorBuilder
from .services.llm.model_router import ModelRouter
from .services.agent.self_evaluator import SelfEvaluator
from .services.memory.episodic_store import EpisodicStore
from .services.rag.graph import EntityExtractor, GraphStore, GraphRetriever
from .services.image import create_image_service
from .services.doc_studio import NotebookIngestService, DocStudioService
from .core.logging import setup_logging

setup_logging()
logger = logging.getLogger(__name__)

# Global app state — accessible from routes
app_state: Dict[str, Any] = {}


async def get_vm_by_id(vm_id: int):
    """Fetch a VMCredential by ID from the database."""
    async with async_session_factory() as session:
        result = await session.execute(
            select(VMCredential).where(VMCredential.id == vm_id)
        )
        return result.scalar_one_or_none()


async def get_all_vms():
    """Fetch all active VMs for system prompt context."""
    async with async_session_factory() as session:
        result = await session.execute(
            select(VMCredential).where(VMCredential.is_active == True)
        )
        return result.scalars().all()


async def save_vm_from_direct_ssh(host: str, username: str, port: int = 22, password: str | None = None):
    """Auto-import a VM after a successful direct SSH connection.

    If a VM with the same host_ip+username already exists, skip.
    """
    async with async_session_factory() as session:
        existing = await session.execute(
            select(VMCredential).where(
                VMCredential.host_ip == host,
                VMCredential.ssh_username == username,
            )
        )
        if existing.scalar_one_or_none():
            return  # already registered

        vm = VMCredential(
            name=f"{username}@{host}",
            provider="imported",
            host_ip=host,
            ssh_username=username,
            ssh_port=port,
            is_active=True,
        )
        if password:
            vm.decrypted_password = password
        session.add(vm)
        await session.commit()
        logger.info("Auto-imported VM: %s@%s:%d", username, host, port)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Startup/shutdown lifecycle."""
    settings = get_settings()
    logger.info("Starting %s (env=%s)", settings.app_name, settings.app_env)

    # Fail fast if running in production with insecure default credentials
    settings.validate_production_settings()

    # Initialize database
    await init_db()

    # Browser automation (Playwright) — headless Chromium for UI testing
    _playwright = None
    _browser = None
    try:
        from playwright.async_api import async_playwright as _async_playwright
        _playwright = await _async_playwright().start()
        _browser = await _playwright.chromium.launch(
            headless=True,
            args=["--no-sandbox", "--disable-dev-shm-usage"],
        )
        logger.info("Playwright Chromium browser started")
    except Exception as _pw_err:
        logger.warning("Playwright unavailable — browser tools disabled: %s", _pw_err)

    # Services
    llm = OllamaService()
    guardrails = GuardrailService()
    ssh_executor = SSHExecutor()
    workspace_root = str(settings.resolved_workspace)
    doc_service = DocumentGeneratorService(workspace_root)

    # Image generation service
    image_service = create_image_service(
        workspace_root,
        image_gen_api_url=settings.image_gen_api_url,
        image_provider=settings.image_provider or None,
        sdxl_model_id=settings.sdxl_model_id,
    )
    app_state["image_service"] = image_service

    # Attachment storage (multimodal)
    from .services.attachments.storage import AttachmentStorage

    attachment_storage: AttachmentStorage | None = None
    if settings.attachments_enabled:
        attachment_storage = AttachmentStorage()
        app_state["attachment_storage"] = attachment_storage
        logger.info("Attachment storage initialised (dir=%s)", settings.upload_dir)

    # RAG services (Qdrant + Ollama embeddings) — graceful if Qdrant unavailable
    embedding_service = EmbeddingService()
    qdrant_store = QdrantStore()
    # Pass llm so Phase 1 enhancements (query rewriting, multi-query, HyDE) are active.
    retriever = RetrieverService(qdrant_store, embedding_service, llm=llm)
    # Phase 2: CRAG wrapper scores retrieval quality and advises web-search fallback.
    corrective_retriever = CorrectiveRetriever(
        retriever=retriever,
        high_threshold=settings.rag_crag_high_threshold,
        low_threshold=settings.rag_crag_low_threshold,
    )
    # Phase 2: self-evaluator scores final LLM answers; triggers one retry if poor.
    self_evaluator = SelfEvaluator(llm=llm, threshold=settings.agent_self_eval_threshold)
    # Phase 3: episodic memory — Qdrant-backed vector store for past episodes.
    episodic_store = EpisodicStore(
        qdrant_store=qdrant_store,
        embeddings=embedding_service,
        collection=settings.memory_episodic_collection,
        max_episodes=settings.memory_episodic_max_episodes,
    )
    # Expose in app_state for the Memory API
    app_state["episodic_store"] = episodic_store
    app_state["agent_memory"] = None  # will be set below after agent_memory is created

    # Phase 4: Graph RAG (LazyGraphRAG)
    graph_store = GraphStore()
    await graph_store.ensure_tables()
    entity_extractor = EntityExtractor(
        llm=llm if settings.rag_graph_llm_extraction else None
    )
    graph_retriever = GraphRetriever(
        graph_store=graph_store,
        entity_extractor=entity_extractor,
        qdrant_store=qdrant_store,
        embeddings=embedding_service,
        hops=settings.rag_graph_hops,
    )
    # Re-create retriever with graph lane wired in
    retriever = RetrieverService(
        qdrant_store, embedding_service,
        llm=llm,
        graph_retriever=graph_retriever if settings.rag_graph_enabled else None,
    )
    # Update the corrective retriever to use the graph-aware retriever
    corrective_retriever = CorrectiveRetriever(
        retriever=retriever,
        high_threshold=settings.rag_crag_high_threshold,
        low_threshold=settings.rag_crag_low_threshold,
    )
    # Expose graph store in app_state for the KG explorer API
    app_state["graph_store"] = graph_store
    app_state["graph_retriever"] = graph_retriever

    chunker = TextChunker()  # must be defined before Phase 5 uses it as fallback

    # Phase 5: Advanced chunking + RAPTOR + Model Router
    # Create a fresh TextChunker for AST fallback (avoids ordering dependency with ingest_service)
    _fallback_chunker = TextChunker()
    ast_chunker = ASTChunker(
        max_chunk_chars=settings.kb_ast_chunk_max_chars,
        fallback_chunker=_fallback_chunker,
    ) if settings.kb_ast_chunk_enabled else None
    raptor_builder = RaptorBuilder(
        llm=llm,
        store=qdrant_store,
        embeddings=embedding_service,
        cluster_size=settings.rag_raptor_cluster_size,
        max_levels=settings.rag_raptor_max_levels,
    ) if settings.rag_raptor_enabled else None
    model_router = ModelRouter()
    app_state["model_router"] = model_router
    logger.info(
        "Phase 5: AST chunker=%s RAPTOR=%s ModelRouter=active",
        settings.kb_ast_chunk_enabled, settings.rag_raptor_enabled,
    )

    ingest_service = IngestService(
        qdrant_store, embedding_service, chunker,
        graph_store=graph_store if settings.rag_graph_enabled else None,
        entity_extractor=entity_extractor if settings.rag_graph_enabled else None,
        ast_chunker=ast_chunker,
        raptor_builder=raptor_builder,
    )

    qdrant_ok = False
    try:
        await qdrant_store.ensure_collection()
        qdrant_ok = True
        logger.info("Qdrant connected — collection '%s' ready", settings.qdrant_collection)
    except Exception as e:
        logger.warning("Qdrant unavailable at startup (non-fatal): %s", e)

    # Tool registry
    registry = ToolRegistry()
    tools_list = [
        GeneratePDF(doc_service),
        GenerateXLSX(doc_service),
        GenerateDOCX(doc_service),
        GeneratePPTX(doc_service),
        GenerateImage(doc_service),
        # List vm_health_check before ssh_command so the system prompt prioritizes health for status asks
        VMHealthTool(ssh_executor, get_vm_func=get_vm_by_id, save_vm_func=save_vm_from_direct_ssh),
        SSHCommandTool(ssh_executor, guardrails, get_vm_func=get_vm_by_id, save_vm_func=save_vm_from_direct_ssh),
        HostEnvironmentTool(),
        OllamaModelStatusTool(),
        ListHostPathTool(),
        SandboxedTerminalTool(guardrails) if settings.sandbox_enabled else TerminalCommandTool(guardrails),
        FetchUrlTool(),
        KnowledgeSearchTool(retriever, corrective_retriever=corrective_retriever),
        WriteFileTool(workspace_root),
        ApplyPatchTool(workspace_root),
        DiagnoseVMTool(ssh_executor, get_vm_func=get_vm_by_id, save_vm_func=save_vm_from_direct_ssh),
        WebSearchTool(),
        CreatePlanTool(),
        GetPlatformStatsTool(db_session_factory=async_session_factory),
        ConfigureMCPTool(),   # Phase IDE: AI-driven MCP configuration
    ]
    registry.register_many(tools_list)

    # Agent memory — persists tool findings across conversations
    agent_memory = AgentMemory(storage_path="data/agent_memory.json")

    # Agent orchestrator
    orchestrator = AgentOrchestrator(
        llm, registry, guardrails,
        get_all_vms_func=get_all_vms,
        attachment_storage=attachment_storage,
        memory=agent_memory,
        evaluator=self_evaluator,     # Phase 2: self-correction
        episodic_store=episodic_store, # Phase 3: episodic memory
    )
    app_state["agent_memory"] = agent_memory

    # Testing orchestrator — dedicated registry with testing-only tools
    testing_registry = ToolRegistry()
    _browser_tools = []
    if _browser is not None:
        _browser_tools = [
            BrowserNavigateTool(_browser),
            BrowserScreenshotTool(_browser),
            BrowserFillFormTool(_browser),
            BrowserClickTool(_browser),
            BrowserEvaluateTool(_browser),
            BrowserPageMapTool(_browser),
            DiscoverPlatformTool(_browser),
        ]
    testing_registry.register_many([
        ProbeApiTargetTool(),
        RunApiTestsTool(),
        AnalyzeTestFailuresTool(),
        RunLocalPytestTool(),
        GenerateTestCodeTool(),
        *_browser_tools,
    ])
    testing_orchestrator = TestingOrchestrator(llm, testing_registry, guardrails)

    # Store in app state
    app_state["orchestrator"] = orchestrator
    app_state["testing_orchestrator"] = testing_orchestrator
    app_state["llm"] = llm
    app_state["registry"] = registry
    app_state["ssh_executor"] = ssh_executor
    app_state["guardrails"] = guardrails
    app_state["doc_service"] = doc_service
    app_state["embedding_service"] = embedding_service
    app_state["qdrant_store"] = qdrant_store
    app_state["retriever"] = retriever
    app_state["ingest_service"] = ingest_service

    # Docker deployment pipeline executor
    from .services.deployment.pipeline_executor import PipelineExecutor
    pipeline_executor = PipelineExecutor(ssh_executor)
    app_state["pipeline_executor"] = pipeline_executor

    # Doc Studio services
    notebook_ingest = NotebookIngestService(
        store=qdrant_store,
        embeddings=embedding_service,
        chunker=chunker,
        ingest_service=ingest_service,
        workspace_root=workspace_root,
    )
    studio_service = DocStudioService(
        retriever=retriever,
        llm=llm,
        doc_generator=doc_service,
    )
    app_state["notebook_ingest"] = notebook_ingest
    app_state["studio_service"] = studio_service

    # Background scheduler
    scheduler = create_default_scheduler()
    await scheduler.start()
    app_state["scheduler"] = scheduler

    # Wire scheduler into platform stats tool
    stats_tool = registry.get("get_platform_stats")
    if stats_tool:
        stats_tool._scheduler = scheduler

    logger.info(
        "AIPiloty ready — %d tools registered (Qdrant: %s)",
        len(registry.tool_names),
        "connected" if qdrant_ok else "unavailable",
    )

    # Pre-warm the LLM model so the first user request doesn't hit cold-start
    # latency (~7-8s on a 9.6 GB model).  Fire-and-forget in the background so
    # it doesn't block the server from accepting requests while warming up.
    asyncio.create_task(llm.warm_up())

    yield

    # Shutdown
    await scheduler.stop()
    ssh_executor.close_all()
    await qdrant_store.close()
    from .services.llm.ollama_service import close_http_client
    await close_http_client()
    if _browser is not None:
        try:
            await _browser.close()
        except Exception:
            pass
    if _playwright is not None:
        try:
            await _playwright.stop()
        except Exception:
            pass
    logger.info("AIPiloty shutdown complete")


def create_app() -> FastAPI:
    settings = get_settings()

    app = FastAPI(
        title=settings.app_name,
        version="1.0.0",
        lifespan=lifespan,
        # Disable interactive API docs in production — they expose the full
        # API surface without authentication and can be used for reconnaissance.
        docs_url=None if settings.is_production else "/docs",
        redoc_url=None if settings.is_production else "/redoc",
        openapi_url=None if settings.is_production else "/openapi.json",
    )

    # CORS — in production reject wildcard origins; enforce explicit list
    origins = [o.strip() for o in settings.cors_origins.split(",") if o.strip()]
    if settings.is_production:
        # Block wildcard; if somehow "*" crept in, raise loudly at startup
        if "*" in origins:
            raise RuntimeError(
                "CORS_ORIGINS contains '*' which is forbidden in production. "
                "Set CORS_ORIGINS to your explicit frontend origin(s)."
            )
    app.add_middleware(
        CORSMiddleware,
        allow_origins=origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    # Request ID tracing (must be outermost so all downstream middleware sees the ID)
    app.add_middleware(RequestIDMiddleware)

    # Prevent OOM from oversized request bodies (default 50 MB)
    app.add_middleware(BodySizeLimitMiddleware)

    # Rate limiting
    app.add_middleware(RateLimitMiddleware)

    # Audit logging
    app.add_middleware(AuditMiddleware)

    # Routes
    from .api.v1.chat import router as chat_router
    from .api.v1.config import router as config_router
    from .api.v1.database import router as database_router
    from .api.v1.deployments import router as deploy_router
    from .api.v1.files import router as files_router
    from .api.v1.health import router as health_router
    from .api.v1.knowledge import router as knowledge_router
    from .api.v1.rag import router as rag_router
    from .api.v1.vms import router as vms_router
    from .api.v1.workspace import router as workspace_router
    from .api.v1.images import router as images_router
    from .api.v1.auth import router as auth_router
    from .api.v1.attachments import router as attachments_router
    from .api.v1.logs import router as logs_router
    from .api.v1.metrics import router as metrics_router
    from .api.v1.git import router as git_router
    from .api.v1.audit_log import router as audit_log_router
    from .api.v1.webhooks import router as webhooks_router
    from .api.v1.scheduler import router as scheduler_router
    from .api.v1.runbooks import router as runbooks_router
    from .api.v1.infrastructure import router as infra_router
    from .api.v1.projects import router as projects_router
    from .api.v1.filesystem import router as filesystem_router
    from .api.v1.mcp_config import router as mcp_router
    from .api.v1.testing import router as testing_router
    from .api.v1.doc_studio import router as doc_studio_router
    from .api.v1.system_manager import router as system_manager_router
    from .api.v1.memory import router as memory_router  # Phase 3

    app.include_router(health_router, prefix="/api/v1")
    app.include_router(auth_router, prefix="/api/v1")
    app.include_router(chat_router, prefix="/api/v1")
    app.include_router(deploy_router, prefix="/api/v1")
    app.include_router(vms_router, prefix="/api/v1")
    app.include_router(files_router, prefix="/api/v1")
    app.include_router(knowledge_router, prefix="/api/v1")
    app.include_router(rag_router, prefix="/api/v1")
    app.include_router(memory_router, prefix="/api/v1")  # Phase 3
    app.include_router(database_router, prefix="/api/v1")
    app.include_router(workspace_router, prefix="/api/v1")
    app.include_router(images_router, prefix="/api/v1")
    app.include_router(attachments_router, prefix="/api/v1")
    app.include_router(config_router, prefix="/api/v1")
    app.include_router(logs_router, prefix="/api/v1")
    app.include_router(metrics_router, prefix="/api/v1")
    app.include_router(git_router, prefix="/api/v1")
    app.include_router(audit_log_router, prefix="/api/v1")
    app.include_router(webhooks_router, prefix="/api/v1")
    app.include_router(scheduler_router, prefix="/api/v1")
    app.include_router(runbooks_router, prefix="/api/v1")
    app.include_router(infra_router, prefix="/api/v1")
    app.include_router(projects_router, prefix="/api/v1")
    app.include_router(filesystem_router, prefix="/api/v1")
    app.include_router(mcp_router, prefix="/api/v1")
    app.include_router(testing_router, prefix="/api/v1")
    app.include_router(doc_studio_router, prefix="/api/v1")
    app.include_router(system_manager_router, prefix="/api/v1")

    # Global catch-all: never expose stack traces to clients
    @app.exception_handler(Exception)
    async def _global_exception_handler(req: _Request, exc: Exception) -> _JSONResponse:
        request_id = getattr(req.state, "request_id", "unknown")
        logger.exception(
            "Unhandled error [%s] %s %s",
            request_id,
            req.method,
            req.url.path,
        )
        return _JSONResponse(
            status_code=500,
            content={"error": "internal_server_error", "request_id": request_id},
        )

    return app


app = create_app()
