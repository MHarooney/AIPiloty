import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:dio/dio.dart';

import '../../core/network/api_client.dart';

class HealthScreen extends ConsumerStatefulWidget {
  const HealthScreen({super.key});

  @override
  ConsumerState<HealthScreen> createState() => _HealthScreenState();
}

class _HealthScreenState extends ConsumerState<HealthScreen> {
  Map<String, dynamic>? _health;
  Map<String, dynamic>? _ragHealth;
  bool _loading = true;
  String? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });

    try {
      final dio = ref.read(dioProvider);

      final results = await Future.wait([
        dio.get('/api/v1/health').catchError((_) => Response(
            requestOptions: RequestOptions(), statusCode: 500, data: null)),
        dio.get('/api/v1/rag/health').catchError((_) => Response(
            requestOptions: RequestOptions(), statusCode: 500, data: null)),
      ]);

      setState(() {
        _health = results[0].data is Map
            ? Map<String, dynamic>.from(results[0].data)
            : null;
        _ragHealth = results[1].data is Map
            ? Map<String, dynamic>.from(results[1].data)
            : null;
        _loading = false;
      });
    } catch (e) {
      setState(() {
        _error = e.toString();
        _loading = false;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Health'),
        actions: [
          IconButton(icon: const Icon(Icons.refresh), onPressed: _load),
        ],
      ),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : _error != null
              ? Center(
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Icon(Icons.error_outline,
                          size: 48, color: Theme.of(context).colorScheme.error),
                      const SizedBox(height: 8),
                      Text(_error!),
                      const SizedBox(height: 16),
                      FilledButton(onPressed: _load, child: const Text('Retry')),
                    ],
                  ),
                )
              : RefreshIndicator(
                  onRefresh: _load,
                  child: ListView(
                    padding: const EdgeInsets.all(16),
                    children: [
                      _sectionTitle('Backend'),
                      _statusCard(
                        icon: Icons.dns,
                        label: 'API Server',
                        ok: _health != null,
                        detail: _health?['status'] ?? 'unreachable',
                      ),
                      _statusCard(
                        icon: Icons.memory,
                        label: 'Ollama',
                        ok: _health?['ollama'] == true ||
                            _health?['ollama_status'] == 'connected',
                        detail: _health?['model'] ?? '',
                      ),
                      _statusCard(
                        icon: Icons.build,
                        label: 'Tools',
                        ok: (_health?['tool_count'] ?? 0) > 0,
                        detail: '${_health?['tool_count'] ?? 0} registered',
                      ),
                      const SizedBox(height: 24),
                      _sectionTitle('RAG / Knowledge Base'),
                      _statusCard(
                        icon: Icons.storage,
                        label: 'Qdrant',
                        ok: _ragHealth?['qdrant'] == 'ok' ||
                            _ragHealth?['qdrant'] == true,
                        detail: _ragHealth?['qdrant']?.toString() ?? 'unknown',
                      ),
                      _statusCard(
                        icon: Icons.auto_awesome,
                        label: 'Embedding Model',
                        ok: _ragHealth?['embedding_model'] == 'ok' ||
                            _ragHealth?['embedding_model'] == true,
                        detail: _ragHealth?['embedding_model']?.toString() ??
                            'unknown',
                      ),
                      _statusCard(
                        icon: Icons.description,
                        label: 'Documents',
                        ok: true,
                        detail:
                            '${_ragHealth?['doc_count'] ?? 0} chunks indexed',
                      ),
                    ],
                  ),
                ),
    );
  }

  Widget _sectionTitle(String title) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: Text(
        title,
        style: Theme.of(context).textTheme.titleMedium?.copyWith(
              fontWeight: FontWeight.bold,
            ),
      ),
    );
  }

  Widget _statusCard({
    required IconData icon,
    required String label,
    required bool ok,
    required String detail,
  }) {
    final cs = Theme.of(context).colorScheme;

    return Card(
      margin: const EdgeInsets.only(bottom: 8),
      child: ListTile(
        leading: Icon(icon, color: cs.primary),
        title: Text(label),
        subtitle: Text(detail),
        trailing: Icon(
          ok ? Icons.check_circle : Icons.cancel,
          color: ok ? Colors.green : Colors.red,
        ),
      ),
    );
  }
}
