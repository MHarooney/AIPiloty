import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:dio/dio.dart';

import '../../core/network/api_client.dart';

class RunbooksScreen extends ConsumerStatefulWidget {
  const RunbooksScreen({super.key});

  @override
  ConsumerState<RunbooksScreen> createState() => _RunbooksScreenState();
}

class _RunbooksScreenState extends ConsumerState<RunbooksScreen> {
  List<Map<String, dynamic>> _runbooks = [];
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
      final res = await ref.read(dioProvider).get('/api/v1/runbooks/');
      final data = res.data;
      setState(() {
        _runbooks = data is List
            ? List<Map<String, dynamic>>.from(data.map((e) => Map<String, dynamic>.from(e as Map)))
            : data is Map
                ? List<Map<String, dynamic>>.from(((data['items'] ?? data['runbooks'] ?? []) as List).map((e) => Map<String, dynamic>.from(e as Map)))
                : [];
        _loading = false;
      });
    } on DioException catch (e) {
      setState(() { _error = e.response?.data?['detail']?.toString() ?? e.message ?? 'Failed'; _loading = false; });
    } catch (e) {
      setState(() { _error = 'Error: $e'; _loading = false; });
    }
  }

  Future<void> _delete(int id, String name) async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Delete runbook?'),
        content: Text('Delete "$name"?'),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Cancel')),
          FilledButton(onPressed: () => Navigator.pop(ctx, true), style: FilledButton.styleFrom(backgroundColor: Colors.red), child: const Text('Delete')),
        ],
      ),
    );
    if (ok != true) return;
    try {
      await ref.read(dioProvider).delete('/api/v1/runbooks/$id');
      _load();
    } catch (e) {
      _snack('Delete failed: $e', error: true);
    }
  }

  Future<void> _execute(int id, String name) async {
    // Fetch VMs for picker
    List<Map<String, dynamic>> vms = [];
    try {
      final res = await ref.read(dioProvider).get('/api/v1/vms/');
      final data = res.data;
      vms = data is List
          ? List<Map<String, dynamic>>.from(data.map((e) => Map<String, dynamic>.from(e as Map)))
          : data is Map
              ? List<Map<String, dynamic>>.from(((data['items'] ?? data['vms'] ?? []) as List).map((e) => Map<String, dynamic>.from(e as Map)))
              : [];
    } catch (_) {}

    if (!mounted) return;

    if (vms.isEmpty) {
      _snack('No VMs available', error: true);
      return;
    }

    int? selectedVmId;
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => StatefulBuilder(
        builder: (ctx, setS) => AlertDialog(
          title: Text('Execute "$name"'),
          content: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              const Text('Select target VM:', style: TextStyle(fontSize: 13)),
              const SizedBox(height: 8),
              ...vms.map((vm) {
                final vmId = vm['id'] as int? ?? 0;
                final vmName = vm['name']?.toString() ?? vm['host_ip']?.toString() ?? 'VM $vmId';
                return RadioListTile<int>(
                  title: Text(vmName),
                  subtitle: Text(vm['host_ip']?.toString() ?? '', style: const TextStyle(fontSize: 11)),
                  value: vmId,
                  groupValue: selectedVmId,
                  onChanged: (v) => setS(() => selectedVmId = v),
                  contentPadding: EdgeInsets.zero,
                  dense: true,
                );
              }),
            ],
          ),
          actions: [
            TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Cancel')),
            FilledButton(
              onPressed: selectedVmId == null ? null : () => Navigator.pop(ctx, true),
              child: const Text('Execute'),
            ),
          ],
        ),
      ),
    );
    if (ok != true || selectedVmId == null) return;
    try {
      await ref.read(dioProvider).post('/api/v1/runbooks/$id/execute', data: {'vm_id': selectedVmId});
      _snack('Runbook "$name" execution started');
    } catch (e) {
      _snack('Execution failed: $e', error: true);
    }
  }

  Future<void> _showCreateDialog() async {
    final nameCtrl = TextEditingController();
    final descCtrl = TextEditingController();
    final steps    = <Map<String, TextEditingController>>[];
    final formKey  = GlobalKey<FormState>();

    steps.add({'command': TextEditingController(), 'description': TextEditingController()});

    await showDialog(
      context: context,
      builder: (ctx) => StatefulBuilder(
        builder: (ctx, setS) => AlertDialog(
          title: const Text('New Runbook'),
          scrollable: true,
          content: SizedBox(
            width: MediaQuery.of(ctx).size.width * 0.9,
            child: Form(
              key: formKey,
              child: Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  TextFormField(
                    controller: nameCtrl,
                    decoration: const InputDecoration(labelText: 'Name'),
                    validator: (v) => v == null || v.trim().isEmpty ? 'Required' : null,
                  ),
                  const SizedBox(height: 10),
                  TextFormField(
                    controller: descCtrl,
                    decoration: const InputDecoration(labelText: 'Description (optional)'),
                    maxLines: 2,
                  ),
                  const SizedBox(height: 16),
                  Row(children: [
                    const Text('Steps', style: TextStyle(fontWeight: FontWeight.w600)),
                    const Spacer(),
                    TextButton.icon(
                      onPressed: () => setS(() => steps.add({'command': TextEditingController(), 'description': TextEditingController()})),
                      icon: const Icon(Icons.add, size: 16),
                      label: const Text('Add step'),
                      style: TextButton.styleFrom(padding: const EdgeInsets.symmetric(horizontal: 4)),
                    ),
                  ]),
                  ...steps.asMap().entries.map((entry) {
                    final i = entry.key;
                    final s = entry.value;
                    return Container(
                      margin: const EdgeInsets.only(top: 8),
                      padding: const EdgeInsets.all(10),
                      decoration: BoxDecoration(
                        border: Border.all(color: Colors.grey.withOpacity(0.3)),
                        borderRadius: BorderRadius.circular(8),
                      ),
                      child: Column(children: [
                        Row(children: [
                          Text('Step ${i + 1}', style: const TextStyle(fontSize: 11, fontWeight: FontWeight.w600)),
                          const Spacer(),
                          if (steps.length > 1) IconButton(
                            icon: const Icon(Icons.close, size: 14),
                            onPressed: () => setS(() => steps.removeAt(i)),
                            padding: EdgeInsets.zero,
                            constraints: const BoxConstraints(),
                          ),
                        ]),
                        const SizedBox(height: 6),
                        TextFormField(
                          controller: s['command'],
                          decoration: const InputDecoration(labelText: 'Command', isDense: true),
                          style: const TextStyle(fontFamily: 'monospace', fontSize: 12),
                          validator: (v) => v == null || v.trim().isEmpty ? 'Required' : null,
                        ),
                        const SizedBox(height: 6),
                        TextFormField(
                          controller: s['description'],
                          decoration: const InputDecoration(labelText: 'Step description (optional)', isDense: true),
                          style: const TextStyle(fontSize: 12),
                        ),
                      ]),
                    );
                  }),
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
                  await ref.read(dioProvider).post('/api/v1/runbooks/', data: {
                    'name': nameCtrl.text.trim(),
                    if (descCtrl.text.trim().isNotEmpty) 'description': descCtrl.text.trim(),
                    'steps': steps.map((s) => {
                      'command': s['command']!.text.trim(),
                      if (s['description']!.text.trim().isNotEmpty) 'description': s['description']!.text.trim(),
                    }).toList(),
                  });
                  _load();
                  _snack('Runbook created');
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
        title: const Text('Runbooks'),
        actions: [IconButton(icon: const Icon(Icons.refresh), onPressed: _load)],
      ),
      floatingActionButton: FloatingActionButton.extended(
        onPressed: _showCreateDialog,
        icon: const Icon(Icons.add),
        label: const Text('New'),
      ),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : _error != null
              ? _errorView(cs)
              : _runbooks.isEmpty
                  ? _emptyView(cs)
                  : RefreshIndicator(
                      onRefresh: _load,
                      child: ListView.separated(
                        padding: const EdgeInsets.fromLTRB(12, 12, 12, 88),
                        itemCount: _runbooks.length,
                        separatorBuilder: (_, __) => const SizedBox(height: 8),
                        itemBuilder: (_, i) => _card(_runbooks[i], cs),
                      ),
                    ),
    );
  }

  Widget _card(Map<String, dynamic> rb, ColorScheme cs) {
    final id    = rb['id'] as int? ?? 0;
    final name  = rb['name']?.toString() ?? 'Unnamed';
    final desc  = rb['description']?.toString() ?? '';
    final steps = rb['steps'] is List ? (rb['steps'] as List).length : rb['steps_count'] as int? ?? 0;

    return Card(
      elevation: 0,
      color: cs.surfaceContainerHighest.withOpacity(0.45),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14), side: BorderSide(color: cs.outline.withOpacity(0.12))),
      child: Padding(
        padding: const EdgeInsets.fromLTRB(16, 12, 8, 8),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Row(children: [
            Expanded(child: Text(name, style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 14))),
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
              decoration: BoxDecoration(color: cs.primaryContainer, borderRadius: BorderRadius.circular(8)),
              child: Text('$steps steps', style: TextStyle(fontSize: 10, color: cs.onPrimaryContainer, fontWeight: FontWeight.bold)),
            ),
          ]),
          if (desc.isNotEmpty) ...[
            const SizedBox(height: 4),
            Text(desc, maxLines: 2, overflow: TextOverflow.ellipsis, style: TextStyle(fontSize: 12, color: cs.onSurface.withOpacity(0.55))),
          ],
          const SizedBox(height: 8),
          Row(children: [
            FilledButton.tonalIcon(
              onPressed: () => _execute(id, name),
              icon: const Icon(Icons.play_arrow, size: 15),
              label: const Text('Execute', style: TextStyle(fontSize: 12)),
              style: FilledButton.styleFrom(padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6), minimumSize: Size.zero, tapTargetSize: MaterialTapTargetSize.shrinkWrap),
            ),
            const Spacer(),
            IconButton(
              icon: const Icon(Icons.delete_outline, size: 18),
              color: Colors.red[400],
              onPressed: () => _delete(id, name),
              tooltip: 'Delete',
            ),
          ]),
        ]),
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
          Icon(Icons.book_outlined, size: 56, color: cs.onSurface.withOpacity(0.2)),
          const SizedBox(height: 12),
          Text('No runbooks yet', style: TextStyle(color: cs.onSurface.withOpacity(0.5))),
          const SizedBox(height: 4),
          Text('Tap + to create one', style: TextStyle(fontSize: 12, color: cs.onSurface.withOpacity(0.3))),
        ]),
      );
}
