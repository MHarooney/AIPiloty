import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'core/config/app_config.dart';
import 'core/providers/session_provider.dart';
import 'core/theme/app_theme.dart';
import 'core/widgets/offline_banner.dart';
import 'features/connection/connection_screen.dart';
import 'features/chat/chat_screen.dart';
import 'features/sessions/sessions_screen.dart';
import 'features/health/health_screen.dart';
import 'features/knowledge/knowledge_search_screen.dart';
import 'features/deployments/deployments_screen.dart';
import 'features/vms/vms_screen.dart';
import 'features/dashboard/dashboard_screen.dart';
import 'features/scheduler/scheduler_screen.dart';
import 'features/webhooks/webhooks_screen.dart';
import 'features/runbooks/runbooks_screen.dart';
import 'features/database/database_screen.dart';
import 'features/images/images_screen.dart';
import 'features/metrics/metrics_screen.dart';
import 'features/code/code_viewer_screen.dart';
import 'features/audit/audit_log_screen.dart';

void main() {
  runApp(const ProviderScope(child: AIPilotyApp()));
}

class AIPilotyApp extends ConsumerWidget {
  const AIPilotyApp({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final config = ref.watch(appConfigProvider);

    return MaterialApp(
      title: 'AIPiloty',
      debugShowCheckedModeBanner: false,
      theme: AppTheme.dark,
      home: config.when(
        data: (cfg) =>
            cfg != null ? const HomeShell() : const ConnectionScreen(),
        loading: () => const Scaffold(
          body: Center(child: CircularProgressIndicator()),
        ),
        error: (_, __) => const ConnectionScreen(),
      ),
    );
  }
}

/// Bottom-nav shell
class HomeShell extends ConsumerStatefulWidget {
  const HomeShell({super.key});

  @override
  ConsumerState<HomeShell> createState() => _HomeShellState();
}

class _HomeShellState extends ConsumerState<HomeShell> {
  int _index = 0;

  late final List<Widget> _pages;

  @override
  void initState() {
    super.initState();
    _pages = [
      const ChatScreen(),
      SessionsScreen(onSwitchToChat: () => setState(() => _index = 0)),
      const DeploymentsScreen(),
      const DashboardScreen(),
      const VMsScreen(),
    ];
  }

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    // Watch tab-switch requests from Dashboard / other screens
    final requested = ref.read(homeTabIndexProvider);
    if (requested != _index) {
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (mounted) setState(() => _index = ref.read(homeTabIndexProvider));
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    // React to programmatic tab switches
    ref.listen(homeTabIndexProvider, (_, next) {
      if (next != _index) setState(() => _index = next);
    });

    return Scaffold(
      body: Column(
        children: [
          const OfflineBanner(),
          Expanded(child: IndexedStack(index: _index, children: _pages)),
        ],
      ),
      endDrawer: Drawer(
        child: SafeArea(
          child: ListView(
            padding: const EdgeInsets.symmetric(vertical: 8),
            children: [
              const Padding(
                padding: EdgeInsets.fromLTRB(16, 8, 16, 4),
                child: Text('More', style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold)),
              ),
              // ── Knowledge ────────────────────────────────────
              _drawerSection('Knowledge'),
              _drawerItem(context, Icons.library_books_outlined, 'Knowledge Base', 'Search & manage docs', const KnowledgeSearchScreen()),
              const Divider(indent: 16, endIndent: 16),
              // ── Automation ───────────────────────────────────
              _drawerSection('Automation'),
              _drawerItem(context, Icons.schedule_outlined,  'Scheduler',  'Cron job management',   const SchedulerScreen()),
              _drawerItem(context, Icons.webhook,            'Webhooks',   'Event notifications',   const WebhooksScreen()),
              _drawerItem(context, Icons.book_outlined,      'Runbooks',   'Automated playbooks',   const RunbooksScreen()),
              const Divider(indent: 16, endIndent: 16),
              // ── Infrastructure ────────────────────────────────
              _drawerSection('Infrastructure'),
              _drawerItem(context, Icons.monitor_heart_outlined, 'Health',    'System health',         const HealthScreen()),
              _drawerItem(context, Icons.table_chart_outlined,   'Database',  'Browse tables',         const DatabaseScreen()),
              _drawerItem(context, Icons.bar_chart_outlined,     'Metrics',   'Metrics & logs',        const MetricsScreen()),
              const Divider(indent: 16, endIndent: 16),
              // ── Tools ─────────────────────────────────────────
              _drawerSection('Tools'),
              _drawerItem(context, Icons.auto_awesome_outlined, 'Images',      'AI image generation',  const ImagesScreen()),
              _drawerItem(context, Icons.code,                  'Code Viewer', 'Browse workspace',     const CodeViewerScreen()),
              _drawerItem(context, Icons.policy_outlined,       'Audit Log',   'System action history',const AuditLogScreen()),
            ],
          ),
        ),
      ),
      bottomNavigationBar: NavigationBar(
        selectedIndex: _index,
        onDestinationSelected: (i) {
          setState(() => _index = i);
          ref.read(homeTabIndexProvider.notifier).state = i;
        },
        labelBehavior: NavigationDestinationLabelBehavior.onlyShowSelected,
        destinations: const [
          NavigationDestination(icon: Icon(Icons.chat_bubble_outline), selectedIcon: Icon(Icons.chat_bubble), label: 'Chat'),
          NavigationDestination(icon: Icon(Icons.history_outlined),    selectedIcon: Icon(Icons.history),     label: 'Sessions'),
          NavigationDestination(icon: Icon(Icons.rocket_launch_outlined), selectedIcon: Icon(Icons.rocket_launch), label: 'Deploys'),
          NavigationDestination(icon: Icon(Icons.dashboard_outlined),  selectedIcon: Icon(Icons.dashboard),   label: 'Dashboard'),
          NavigationDestination(icon: Icon(Icons.dns_outlined),        selectedIcon: Icon(Icons.dns),         label: 'VMs'),
        ],
      ),
    );
  }

  Widget _drawerSection(String label) => Padding(
        padding: const EdgeInsets.fromLTRB(16, 8, 16, 2),
        child: Text(label.toUpperCase(), style: TextStyle(fontSize: 10, fontWeight: FontWeight.w700, letterSpacing: 0.8, color: Theme.of(context).colorScheme.onSurface.withOpacity(0.45))),
      );

  Widget _drawerItem(BuildContext context, IconData icon, String title, String subtitle, Widget screen) => ListTile(
        dense: true,
        leading: Icon(icon, size: 20),
        title: Text(title, style: const TextStyle(fontSize: 13)),
        subtitle: Text(subtitle, style: const TextStyle(fontSize: 11)),
        onTap: () {
          Navigator.of(context).pop();
          Navigator.of(context).push(MaterialPageRoute(builder: (_) => screen));
        },
      );
}
