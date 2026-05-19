import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:dio/dio.dart';

import '../../core/network/api_client.dart';

const _kCronPresets = {
  'Every min': '* * * * *',
  'Every 5m':  '*/5 * * * *',
  'Hourly':    '0 * * * *',
  'Daily':     '0 0 * * *',
  'Weekly':    '0 0 * * 0',
};

class SchedulerScreen extends ConsumerStatefulWidget {
  const SchedulerScreen({super.key});

  @override
  ConsumerState<SchedulerScreen> createState() => _SchedulerScreenState();
}

class _SchedulerScreenState extends ConsumerState<SchedulerScreen> {
  List<Map<String, dynamic>> _jobs = [];
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
      final res = await ref.read(dioProvider).get('/api/v1/scheduler/jobs');
      final data = res.data;
      setState(() {
        _jobs = data is List
            ? List<Map<String, dynamic>>.from(data.map((e) => Map<String, dynamic>.from(e as Map)))
            : data is Map
                ? List<Map<String, dynamic>>.from(((data['jobs'] ?? data['items'] ?? []) as List).map((e) => Map<String, dynamic>.from(e as Map)))
                : [];
        _loading = false;
      });
    } on DioException catch (e) {
      setState(() { _error = e.response?.data?['detail']?.toString() ?? e.message ?? 'Failed'; _loading = false; });
    } catch (e) {
      setState(() { _error = 'Error: $e'; _loading = false; });
    }
  }

  Future<void> _toggle(int id, bool currentEnabled) async {
    try {
      await ref.read(dioProvider).post('/api/v1/scheduler/jobs/$id/toggle', data: {'enabled': !currentEnabled});
      _load();
    } catch (e) {
      _snack('Toggle failed: $e', error: true);
    }
  }

  Future<void> _delete(int id, String name) async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Delete job?'),
        content: Text('Delete "$name" permanently?'),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Cancel')),
          FilledButton(onPressed: () => Navigator.pop(ctx, true), style: FilledButton.styleFrom(backgroundColor: Colors.red), child: const Text('Delete')),
        ],
      ),
    );
    if (ok != true) return;
    try {
      await ref.read(dioProvider).delete('/api/v1/scheduler/jobs/$id');
      _load();
    } catch (e) {
      _snack('Delete failed: $e', error: true);
    }
  }

  Future<void> _showCreateDialog() async {
    final nameCtrl    = TextEditingController();
    final cronCtrl    = TextEditingController();
    final commandCtrl = TextEditingController();
    final formKey     = GlobalKey<FormState>();

    await showDialog(
      context: context,
      builder: (ctx) => StatefulBuilder(
        builder: (ctx, setS) => AlertDialog(
          title: const Text('New Scheduled Job'),
          content: SingleChildScrollView(
            child: Form(
              key: formKey,
              child: Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  TextFormField(
                    controller: nameCtrl,
                    decoration: const InputDecoration(labelText: 'Job Name'),
                    validator: (v) => v == null || v.trim().isEmpty ? 'Required' : null,
                  ),
                  const SizedBox(height: 12),
                  TextFormField(
                    controller: cronCtrl,
                    decoration: const InputDecoration(labelText: 'Cron Expression', hintText: '* * * * *'),
                    validator: (v) => v == null || v.trim().isEmpty ? 'Required' : null,
                  ),
                  const SizedBox(height: 8),
                  Wrap(
                    spacing: 6,
                    runSpacing: 4,
                    children: _kCronPresets.entries.map((e) => ActionChip(
                      label: Text(e.key, style: const TextStyle(fontSize: 11)),
                      onPressed: () => setS(() => cronCtrl.text = e.value),
                      visualDensity: VisualDensity.compact,
                    )).toList(),
                  ),
                  const SizedBox(height: 12),
                  TextFormField(
                    controller: commandCtrl,
                    decoration: const InputDecoration(labelText: 'Command / Script'),
                    maxLines: 3,
                    validator: (v) => v == null || v.trim().isEmpty ? 'Required' : null,
                  ),
                ],
              ),
            ),
          ),
          actions: [
            TextButton(onPressed: () => Navigator.pop(ctx), child: const Text('Cancel')),
            FilledButton(
              onPressed: () async {
                if (!formKey.currentState!.validate()) return;
                Navigator.pop(ctx);
                try {
                  await ref.read(dioProvider).post('/api/v1/scheduler/jobs', data: {
                    'name': nameCtrl.text.trim(),
                    'cron_expression': cronCtrl.text.trim(),
                    'command': commandCtrl.text.trim(),
                    'enabled': true,
                  });
                  _load();
                  _snack('Job created');
                } catch (e) {
                  _snack('Failed: $e', error: true);
                }
              },
              child: const Text('Create'),
            ),
          ],
        ),
      ),
    );
  }

  void _snack(String msg, {bool error = false}) {
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(msg), backgroundColor: error ? Colors.red[700] : null));
  }

  @override
  Widget build(BuildContext context) {
    final cs = Theme.of(context).colorScheme;
    return Scaffold(
      appBar: AppBar(
        title: const Text('Scheduler'),
        actions: [IconButton(icon: const Icon(Icons.refresh), onPressed: _load)],
      ),
      floatingActionButton: FloatingActionButton.extended(
        onPressed: _showCreateDialog,
        icon: const Icon(Icons.add),
        label: const Text('New Job'),
      ),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : _error != null
              ? _errorView(cs)
              : _jobs.isEmpty
                  ? _emptyView(cs)
                  : RefreshIndicator(
                      onRefresh: _load,
                      child: ListView.separated(
                        padding: const EdgeInsets.fromLTRB(12, 12, 12, 88),
                        itemCount: _jobs.length,
                        separatorBuilder: (_, __) => const SizedBox(height: 8),
                        itemBuilder: (_, i) => _jobCard(_jobs[i], cs),
                      ),
                    ),
    );
  }

  Widget _jobCard(Map<String, dynamic> job, ColorScheme cs) {
    final id      = job['id'] as int? ?? 0;
    final name    = job['name']?.toString() ?? 'Unnamed';
    final cron    = job['cron_expression']?.toString() ?? job['schedule']?.toString() ?? '';
    final command = job['command']?.toString() ?? '';
    final enabled = job['enabled'] as bool? ?? false;

    return Card(
      elevation: 0,
      color: cs.surfaceContainerHighest.withOpacity(0.45),
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(14),
        side: BorderSide(color: cs.outline.withOpacity(0.12)),
      ),
      child: Padding(
        padding: const EdgeInsets.fromLTRB(16, 12, 12, 8),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(children: [
              Expanded(child: Text(name, style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 14))),
              Switch(
                value: enabled,
                onChanged: (_) => _toggle(id, enabled),
              ),
            ]),
            if (cron.isNotEmpty) ...[
              const SizedBox(height: 4),
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                decoration: BoxDecoration(color: cs.primaryContainer, borderRadius: BorderRadius.circular(8)),
                child: Text(cron, style: TextStyle(fontSize: 11, fontFamily: 'monospace', color: cs.onPrimaryContainer)),
              ),
            ],
            if (command.isNotEmpty) ...[
              const SizedBox(height: 6),
              Text(
                command,
                maxLines: 2,
                overflow: TextOverflow.ellipsis,
                style: TextStyle(fontSize: 12, color: cs.onSurface.withOpacity(0.55)),
              ),
            ],
            const SizedBox(height: 8),
            Row(children: [
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
          Icon(Icons.schedule, size: 56, color: cs.onSurface.withOpacity(0.2)),
          const SizedBox(height: 12),
          Text('No scheduled jobs', style: TextStyle(color: cs.onSurface.withOpacity(0.5))),
          const SizedBox(height: 4),
          Text('Tap + to create one', style: TextStyle(fontSize: 12, color: cs.onSurface.withOpacity(0.3))),
        ]),
      );
}
