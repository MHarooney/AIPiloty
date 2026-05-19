import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:dio/dio.dart';

import '../../core/network/api_client.dart';

const _kStatuses = {
  'running':      (Color(0xFF10B981), Icons.check_circle),
  'deployed':     (Color(0xFF10B981), Icons.check_circle),
  'active':       (Color(0xFF10B981), Icons.check_circle),
  'stopped':      (Color(0xFF6B7280), Icons.stop_circle),
  'inactive':     (Color(0xFF6B7280), Icons.stop_circle),
  'failed':       (Color(0xFFEF4444), Icons.error),
  'error':        (Color(0xFFEF4444), Icons.error),
  'deploying':    (Color(0xFFF59E0B), Icons.pending),
  'building':     (Color(0xFFF59E0B), Icons.pending),
  'rolling_back': (Color(0xFFF97316), Icons.replay),
  'pending':      (Color(0xFF6366F1), Icons.hourglass_top),
};

class DeploymentsScreen extends ConsumerStatefulWidget {
  const DeploymentsScreen({super.key});

  @override
  ConsumerState<DeploymentsScreen> createState() => _DeploymentsScreenState();
}

class _DeploymentsScreenState extends ConsumerState<DeploymentsScreen> {
  List<Map<String, dynamic>> _deployments = [];
  bool _loading = true;
  String? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() { _loading = true; _error = null; });
    try {
      final dio = ref.read(dioProvider);
      final res = await dio.get('/api/v1/deployments/');
      final data = res.data;
      setState(() {
        _deployments = data is List
            ? List<Map<String, dynamic>>.from(data.map((e) => Map<String, dynamic>.from(e as Map)))
            : [];
        _loading = false;
      });
    } on DioException catch (e) {
      setState(() { _error = e.response?.data?['detail']?.toString() ?? e.message ?? 'Failed'; _loading = false; });
    } catch (e) {
      setState(() { _error = 'Error: $e'; _loading = false; });
    }
  }

  Future<void> _action(int id, String action) async {
    try {
      await ref.read(dioProvider).post('/api/v1/deployments/$id/action', data: {'action': action});
      _load();
    } catch (e) {
      _snack('Action failed: $e', error: true);
    }
  }

  Future<void> _delete(int id, String name) async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Delete deployment?'),
        content: Text('Delete "$name" permanently?'),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Cancel')),
          FilledButton(
            onPressed: () => Navigator.pop(ctx, true),
            style: FilledButton.styleFrom(backgroundColor: Colors.red),
            child: const Text('Delete'),
          ),
        ],
      ),
    );
    if (ok != true) return;
    try {
      await ref.read(dioProvider).delete('/api/v1/deployments/$id');
      _load();
    } catch (e) {
      _snack('Delete failed: $e', error: true);
    }
  }

  Future<void> _showCreateSheet() async {
    final nameCtrl    = TextEditingController();
    final projectCtrl = TextEditingController();
    final repoCtrl    = TextEditingController();
    final branchCtrl  = TextEditingController(text: 'main');
    String env = 'production';
    final formKey = GlobalKey<FormState>();

    await showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(20))),
      builder: (ctx) => Padding(
        padding: EdgeInsets.only(bottom: MediaQuery.of(ctx).viewInsets.bottom),
        child: SingleChildScrollView(
          padding: const EdgeInsets.fromLTRB(20, 20, 20, 32),
          child: Form(
            key: formKey,
            child: StatefulBuilder(
              builder: (ctx, setS) => Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                mainAxisSize: MainAxisSize.min,
                children: [
                  Row(children: [
                    const Text('New Deployment', style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold)),
                    const Spacer(),
                    IconButton(icon: const Icon(Icons.close), onPressed: () => Navigator.pop(ctx)),
                  ]),
                  const SizedBox(height: 16),
                  _tf(nameCtrl,    'Name',         required: true),
                  const SizedBox(height: 12),
                  _tf(projectCtrl, 'Project Name', required: true),
                  const SizedBox(height: 12),
                  _tf(repoCtrl,    'Repository URL'),
                  const SizedBox(height: 12),
                  _tf(branchCtrl,  'Branch'),
                  const SizedBox(height: 12),
                  DropdownButtonFormField<String>(
                    value: env,
                    decoration: const InputDecoration(labelText: 'Environment'),
                    items: ['production', 'staging', 'development']
                        .map((e) => DropdownMenuItem(value: e, child: Text(e)))
                        .toList(),
                    onChanged: (v) => setS(() => env = v ?? env),
                  ),
                  const SizedBox(height: 20),
                  FilledButton(
                    onPressed: () async {
                      if (!formKey.currentState!.validate()) return;
                      Navigator.pop(ctx);
                      try {
                        await ref.read(dioProvider).post('/api/v1/deployments/', data: {
                          'name': nameCtrl.text.trim(),
                          'project_name': projectCtrl.text.trim(),
                          'repository_url': repoCtrl.text.trim(),
                          'branch': branchCtrl.text.trim(),
                          'environment': env,
                        });
                        _load();
                        _snack('Deployment created');
                      } catch (e) {
                        _snack('Failed: $e', error: true);
                      }
                    },
                    child: const Text('Create Deployment'),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }

  Widget _tf(TextEditingController ctrl, String label, {bool required = false}) =>
      TextFormField(
        controller: ctrl,
        decoration: InputDecoration(labelText: label),
        validator: required ? (v) => (v == null || v.trim().isEmpty) ? 'Required' : null : null,
      );

  void _snack(String msg, {bool error = false}) {
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(
      content: Text(msg),
      backgroundColor: error ? Colors.red[700] : null,
    ));
  }

  @override
  Widget build(BuildContext context) {
    final cs = Theme.of(context).colorScheme;
    return Scaffold(
      appBar: AppBar(
        title: const Text('Deployments'),
        actions: [IconButton(icon: const Icon(Icons.refresh), onPressed: _load)],
      ),
      floatingActionButton: FloatingActionButton.extended(
        onPressed: _showCreateSheet,
        icon: const Icon(Icons.add),
        label: const Text('New'),
      ),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : _error != null
              ? _errorView(cs)
              : _deployments.isEmpty
                  ? _emptyView(cs)
                  : RefreshIndicator(
                      onRefresh: _load,
                      child: ListView.separated(
                        padding: const EdgeInsets.fromLTRB(12, 12, 12, 88),
                        itemCount: _deployments.length,
                        separatorBuilder: (_, __) => const SizedBox(height: 8),
                        itemBuilder: (_, i) => _card(_deployments[i], cs),
                      ),
                    ),
    );
  }

  Widget _card(Map<String, dynamic> d, ColorScheme cs) {
    final id     = d['id'] as int? ?? 0;
    final name   = d['name']?.toString() ?? 'Unnamed';
    final status = (d['status']?.toString() ?? 'unknown').toLowerCase();
    final proj   = d['project_name']?.toString() ?? '';
    final env    = d['environment']?.toString() ?? '';
    final updated = d['updated_at']?.toString() ?? d['created_at']?.toString() ?? '';
    final (color, icon) = _kStatuses[status] ?? (const Color(0xFF6B7280), Icons.help_outline);

    return Card(
      elevation: 0,
      color: cs.surfaceContainerHighest.withOpacity(0.45),
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(14),
        side: BorderSide(color: cs.outline.withOpacity(0.12)),
      ),
      child: Padding(
        padding: const EdgeInsets.fromLTRB(16, 12, 8, 8),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(children: [
              Icon(icon, color: color, size: 18),
              const SizedBox(width: 8),
              Expanded(child: Text(name, style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 14))),
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                decoration: BoxDecoration(color: color.withOpacity(0.15), borderRadius: BorderRadius.circular(8)),
                child: Text(status.toUpperCase(), style: TextStyle(fontSize: 10, color: color, fontWeight: FontWeight.bold)),
              ),
            ]),
            if (proj.isNotEmpty || env.isNotEmpty) ...[
              const SizedBox(height: 4),
              Text('$proj${proj.isNotEmpty && env.isNotEmpty ? " · " : ""}$env',
                  style: TextStyle(fontSize: 12, color: cs.onSurface.withOpacity(0.5))),
            ],
            if (updated.isNotEmpty) ...[
              const SizedBox(height: 2),
              Text(_fmt(updated), style: TextStyle(fontSize: 11, color: cs.onSurface.withOpacity(0.35))),
            ],
            const SizedBox(height: 8),
            Row(children: [
              if (status == 'stopped' || status == 'inactive')
                _actionBtn(Icons.play_arrow, 'Start',    Color(0xFF10B981), () => _action(id, 'start')),
              if (status == 'running' || status == 'active' || status == 'deployed')
                _actionBtn(Icons.stop, 'Stop',          Colors.amber,      () => _action(id, 'stop')),
              if (status == 'failed' || status == 'error')
                _actionBtn(Icons.replay, 'Rollback',    Colors.orange,     () => _action(id, 'rollback')),
              const Spacer(),
              IconButton(
                icon: const Icon(Icons.delete_outline, size: 18),
                color: Colors.red[400],
                onPressed: () => _delete(id, name),
                tooltip: 'Delete',
              ),
            ]),
          ],
        ),
      ),
    );
  }

  Widget _actionBtn(IconData icon, String label, Color color, VoidCallback onTap) =>
      TextButton.icon(
        onPressed: onTap,
        icon: Icon(icon, size: 16, color: color),
        label: Text(label, style: TextStyle(fontSize: 12, color: color)),
        style: TextButton.styleFrom(padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 4)),
      );

  Widget _errorView(ColorScheme cs) => Center(
        child: Column(mainAxisSize: MainAxisSize.min, children: [
          Icon(Icons.error_outline, color: cs.error, size: 40),
          const SizedBox(height: 12),
          Text(_error!, style: TextStyle(color: cs.error), textAlign: TextAlign.center),
          const SizedBox(height: 12),
          FilledButton.icon(onPressed: _load, icon: const Icon(Icons.refresh), label: const Text('Retry')),
        ]),
      );

  Widget _emptyView(ColorScheme cs) => Center(
        child: Column(mainAxisSize: MainAxisSize.min, children: [
          Icon(Icons.rocket_launch_outlined, size: 56, color: cs.onSurface.withOpacity(0.2)),
          const SizedBox(height: 12),
          Text('No deployments yet', style: TextStyle(color: cs.onSurface.withOpacity(0.5))),
          const SizedBox(height: 4),
          Text('Tap + to create one', style: TextStyle(fontSize: 12, color: cs.onSurface.withOpacity(0.3))),
        ]),
      );

  String _fmt(String iso) {
    try {
      final dt = DateTime.parse(iso);
      final d = DateTime.now().difference(dt);
      if (d.inMinutes < 1) return 'just now';
      if (d.inMinutes < 60) return '${d.inMinutes}m ago';
      if (d.inHours < 24) return '${d.inHours}h ago';
      return '${d.inDays}d ago';
    } catch (_) { return iso; }
  }
}
