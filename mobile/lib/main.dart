import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'core/config/app_config.dart';
import 'core/theme/app_theme.dart';
import 'core/widgets/offline_banner.dart';
import 'features/connection/connection_screen.dart';
import 'features/chat/chat_screen.dart';
import 'features/sessions/sessions_screen.dart';
import 'features/health/health_screen.dart';
import 'features/knowledge/knowledge_search_screen.dart';
import 'features/deployments/deployments_screen.dart';
import 'features/vms/vms_screen.dart';
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

/// Bottom-nav shell for Chat / Sessions / Health.
class HomeShell extends StatefulWidget {
  const HomeShell({super.key});

  @override
  State<HomeShell> createState() => _HomeShellState();
}

class _HomeShellState extends State<HomeShell> {
  int _index = 0;

  static const _pages = [
    ChatScreen(),
    SessionsScreen(),
    KnowledgeSearchScreen(),
    DeploymentsScreen(),
    VMsScreen(),
    HealthScreen(),
  ];

  @override
  Widget build(BuildContext context) {
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
            padding: const EdgeInsets.symmetric(vertical: 16),
            children: [
              const Padding(
                padding: EdgeInsets.symmetric(horizontal: 16, vertical: 8),
                child: Text('More Tools',
                    style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold)),
              ),
              ListTile(
                leading: const Icon(Icons.code),
                title: const Text('Code Viewer'),
                subtitle: const Text('Browse workspace files'),
                onTap: () {
                  Navigator.of(context).pop();
                  Navigator.of(context).push(
                    MaterialPageRoute(builder: (_) => const CodeViewerScreen()),
                  );
                },
              ),
              ListTile(
                leading: const Icon(Icons.policy_outlined),
                title: const Text('Audit Log'),
                subtitle: const Text('System action history'),
                onTap: () {
                  Navigator.of(context).pop();
                  Navigator.of(context).push(
                    MaterialPageRoute(builder: (_) => const AuditLogScreen()),
                  );
                },
              ),
            ],
          ),
        ),
      ),
      bottomNavigationBar: NavigationBar(
        selectedIndex: _index,
        onDestinationSelected: (i) => setState(() => _index = i),
        labelBehavior: NavigationDestinationLabelBehavior.onlyShowSelected,
        destinations: const [
          NavigationDestination(
            icon: Icon(Icons.chat_bubble_outline),
            selectedIcon: Icon(Icons.chat_bubble),
            label: 'Chat',
          ),
          NavigationDestination(
            icon: Icon(Icons.history_outlined),
            selectedIcon: Icon(Icons.history),
            label: 'Sessions',
          ),
          NavigationDestination(
            icon: Icon(Icons.library_books_outlined),
            selectedIcon: Icon(Icons.library_books),
            label: 'Knowledge',
          ),
          NavigationDestination(
            icon: Icon(Icons.rocket_launch_outlined),
            selectedIcon: Icon(Icons.rocket_launch),
            label: 'Deploys',
          ),
          NavigationDestination(
            icon: Icon(Icons.dns_outlined),
            selectedIcon: Icon(Icons.dns),
            label: 'VMs',
          ),
          NavigationDestination(
            icon: Icon(Icons.monitor_heart_outlined),
            selectedIcon: Icon(Icons.monitor_heart),
            label: 'Health',
          ),
        ],
      ),
    );
  }
}
