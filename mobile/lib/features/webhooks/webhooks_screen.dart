import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:dio/dio.dart';

import '../../core/network/api_client.dart';

const _kEventOptions = [
  'deployment.created',
  'deployment.started',
  'deployment.completed',
  'deployment.failed',
  'vm.connected',
  'vm.disconnected',
  'chat.tool_executed',
  'chat.error',
  'scheduler.job_completed',
  'scheduler.job_failed',
];

class WebhooksScreen extends ConsumerStatefulWidget {
  const WebhooksScreen({super.key});

  @override
  ConsumerState<WebhooksScreen> createState() => _WebhooksScreenState();
}

class _WebhooksScreenState extends ConsumerState<WebhooksScreen> {
  List<Map<String, dynamic>> _webhooks = [];
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
      final res = await ref.read(dioProvider).get('/api/v1/webhooks/');
      final data = res.data;
      setState(() {
        _webhooks = data is List
            ? List<Map<String, dynamic>>.from(data.map((e) => Map<String, dynamic>.from(e as Map)))
            : data is Map
                ? List<Map<String, dynamic>>.from(((data['items'] ?? data['webhooks'] ?? []) as List).map((e) => Map<String, dynamic>.from(e as Map)))
                : [];
        _loading = false;
      });
    } on DioException catch (e) {
      setState(() { _error = e.response?.data?['detail']?.toString() ?? e.message ?? 'Failed'; _loading = false; });
    } catch (e) {
      setState(() { _error = 'Error: $e'; _loading = false; });
    }
  }

  Future<void> _test(int id, String name) async {
    try {
      await ref.read(dioProvider).post('/api/v1/webhooks/$id/test');
      _snack('Test sent for "$name"');
    } catch (e) {
      _snack('Test failed: $e', error: true);
    }
  }

  Future<void> _delete(int id, String name) async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Delete webhook?'),
        content: Text('Delete "$name"?'),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Cancel')),
          FilledButton(onPressed: () => Navigator.pop(ctx, true), style: FilledButton.styleFrom(backgroundColor: Colors.red), child: const Text('Delete')),
        ],
      ),
    );
    if (ok != true) return;
    try {
      await ref.read(dioProvider).delete('/api/v1/webhooks/$id');
      _load();
    } catch (e) {
      _snack('Delete failed: $e', error: true);
    }
  }

  Future<void> _showCreateSheet() async {
    final nameCtrl   = TextEditingController();
    final urlCtrl    = TextEditingController();
    final secretCtrl = TextEditingController();
    final selected   = <String>{};
    final formKey    = GlobalKey<FormState>();

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
                    const Text('New Webhook', style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold)),
                    const Spacer(),
                    IconButton(icon: const Icon(Icons.close), onPressed: () => Navigator.pop(ctx)),
                  ]),
                  const SizedBox(height: 16),
                  TextFormField(
                    controller: nameCtrl,
                    decoration: const InputDecoration(labelText: 'Name'),
                    validator: (v) => v == null || v.trim().isEmpty ? 'Required' : null,
                  ),
                  const SizedBox(height: 12),
                  TextFormField(
                    controller: urlCtrl,
                    decoration: const InputDecoration(labelText: 'URL', hintText: 'https://'),
                    keyboardType: TextInputType.url,
                    validator: (v) => v == null || !v.startsWith('http') ? 'Enter a valid URL' : null,
                  ),
                  const SizedBox(height: 12),
                  TextFormField(
                    controller: secretCtrl,
                    decoration: const InputDecoration(labelText: 'Secret (optional)'),
                  ),
                  const SizedBox(height: 12),
                  const Text('Events', style: TextStyle(fontWeight: FontWeight.w600)),
                  const SizedBox(height: 8),
                  Wrap(
                    spacing: 6,
                    runSpacing: 6,
                    children: _kEventOptions.map((ev) => FilterChip(
                      label: Text(ev, style: const TextStyle(fontSize: 11)),
                      selected: selected.contains(ev),
                      onSelected: (v) => setS(() => v ? selected.add(ev) : selected.remove(ev)),
                      visualDensity: VisualDensity.compact,
                    )).toList(),
                  ),
                  const SizedBox(height: 20),
                  FilledButton(
                    onPressed: () async {
                      if (!formKey.currentState!.validate()) return;
                      if (selected.isEmpty) {
                        ScaffoldMessenger.of(ctx).showSnackBar(const SnackBar(content: Text('Select at least one event')));
                        return;
                      }
                      Navigator.pop(ctx);
                      try {
                        await ref.read(dioProvider).post('/api/v1/webhooks/', data: {
                          'name': nameCtrl.text.trim(),
                          'url': urlCtrl.text.trim(),
                          'events': selected.toList(),
                          if (secretCtrl.text.isNotEmpty) 'secret': secretCtrl.text,
                        });
                        _load();
                        _snack('Webhook created');
                      } catch (e) {
                        _snack('Failed: $e', error: true);
                      }
                    },
                    child: const Text('Create Webhook'),
                  ),
                ],
              ),
            ),
          ),
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
        title: const Text('Webhooks'),
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
              : _webhooks.isEmpty
                  ? _emptyView(cs)
                  : RefreshIndicator(
                      onRefresh: _load,
                      child: ListView.separated(
                        padding: const EdgeInsets.fromLTRB(12, 12, 12, 88),
                        itemCount: _webhooks.length,
                        separatorBuilder: (_, __) => const SizedBox(height: 8),
                        itemBuilder: (_, i) => _card(_webhooks[i], cs),
                      ),
                    ),
    );
  }

  Widget _card(Map<String, dynamic> wh, ColorScheme cs) {
    final id     = wh['id'] as int? ?? 0;
    final name   = wh['name']?.toString() ?? 'Unnamed';
    final url    = wh['url']?.toString() ?? '';
    final active = wh['active'] as bool? ?? wh['is_active'] as bool? ?? true;
    final events = wh['events'] is List ? List<String>.from(wh['events'] as List) : <String>[];

    return Card(
      elevation: 0,
      color: cs.surfaceContainerHighest.withOpacity(0.45),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14), side: BorderSide(color: cs.outline.withOpacity(0.12))),
      child: Padding(
        padding: const EdgeInsets.fromLTRB(16, 12, 8, 8),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(children: [
              Expanded(child: Text(name, style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 14))),
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                decoration: BoxDecoration(
                  color: (active ? Colors.green : Colors.grey).withOpacity(0.15),
                  borderRadius: BorderRadius.circular(8),
                ),
                child: Text(active ? 'ACTIVE' : 'INACTIVE', style: TextStyle(fontSize: 10, color: active ? Colors.green : Colors.grey, fontWeight: FontWeight.bold)),
              ),
            ]),
            if (url.isNotEmpty) ...[
              const SizedBox(height: 4),
              Text(url, maxLines: 1, overflow: TextOverflow.ellipsis, style: TextStyle(fontSize: 12, fontFamily: 'monospace', color: cs.onSurface.withOpacity(0.5))),
            ],
            if (events.isNotEmpty) ...[
              const SizedBox(height: 8),
              Wrap(
                spacing: 4,
                runSpacing: 4,
                children: events.map((e) => Container(
                  padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                  decoration: BoxDecoration(color: cs.primaryContainer, borderRadius: BorderRadius.circular(6)),
                  child: Text(e, style: TextStyle(fontSize: 10, color: cs.onPrimaryContainer)),
                )).toList(),
              ),
            ],
            const SizedBox(height: 8),
            Row(children: [
              TextButton.icon(
                onPressed: () => _test(id, name),
                icon: const Icon(Icons.send, size: 15),
                label: const Text('Test', style: TextStyle(fontSize: 12)),
                style: TextButton.styleFrom(padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 4)),
              ),
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
          Icon(Icons.webhook, size: 56, color: cs.onSurface.withOpacity(0.2)),
          const SizedBox(height: 12),
          Text('No webhooks configured', style: TextStyle(color: cs.onSurface.withOpacity(0.5))),
          const SizedBox(height: 4),
          Text('Tap + to create one', style: TextStyle(fontSize: 12, color: cs.onSurface.withOpacity(0.3))),
        ]),
      );
}
