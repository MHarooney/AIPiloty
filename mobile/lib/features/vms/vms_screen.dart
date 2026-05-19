import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:dio/dio.dart';

import '../../core/network/api_client.dart';

class VMsScreen extends ConsumerStatefulWidget {
  const VMsScreen({super.key});

  @override
  ConsumerState<VMsScreen> createState() => _VMsScreenState();
}

class _VMsScreenState extends ConsumerState<VMsScreen> {
  List<Map<String, dynamic>> _vms = [];
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
      final res = await dio.get('/api/v1/vms/');
      final data = res.data;
      setState(() {
        _vms = data is List
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

  Future<void> _trustKey(int id) async {
    try {
      await ref.read(dioProvider).post('/api/v1/vms/$id/trust-host-key');
      _load();
      _snack('Host key trusted');
    } catch (e) {
      _snack('Failed: $e', error: true);
    }
  }

  Future<void> _delete(int id, String name) async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Remove VM?'),
        content: Text('Remove "$name" from the list?'),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Cancel')),
          FilledButton(
            onPressed: () => Navigator.pop(ctx, true),
            style: FilledButton.styleFrom(backgroundColor: Colors.red),
            child: const Text('Remove'),
          ),
        ],
      ),
    );
    if (ok != true) return;
    try {
      await ref.read(dioProvider).delete('/api/v1/vms/$id');
      _load();
    } catch (e) {
      _snack('Delete failed: $e', error: true);
    }
  }

  Future<void> _showAddSheet() async {
    final nameCtrl  = TextEditingController();
    final hostCtrl  = TextEditingController();
    final userCtrl  = TextEditingController(text: 'root');
    final passCtrl  = TextEditingController();
    final portCtrl  = TextEditingController(text: '22');
    String provider = 'custom';
    bool showPass   = false;
    final formKey   = GlobalKey<FormState>();

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
                    const Text('Add VM', style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold)),
                    const Spacer(),
                    IconButton(icon: const Icon(Icons.close), onPressed: () => Navigator.pop(ctx)),
                  ]),
                  const SizedBox(height: 16),
                  _tf(nameCtrl, 'Name', required: true),
                  const SizedBox(height: 12),
                  _tf(hostCtrl, 'Host IP / Hostname', required: true),
                  const SizedBox(height: 12),
                  _tf(userCtrl, 'SSH Username', required: true),
                  const SizedBox(height: 12),
                  TextFormField(
                    controller: passCtrl,
                    decoration: InputDecoration(
                      labelText: 'SSH Password',
                      suffixIcon: IconButton(
                        icon: Icon(showPass ? Icons.visibility_off : Icons.visibility),
                        onPressed: () => setS(() => showPass = !showPass),
                      ),
                    ),
                    obscureText: !showPass,
                  ),
                  const SizedBox(height: 12),
                  _tf(portCtrl, 'SSH Port',
                    keyboardType: TextInputType.number,
                    validator: (v) {
                      final n = int.tryParse(v ?? '');
                      return n == null || n < 1 || n > 65535 ? 'Invalid port' : null;
                    },
                  ),
                  const SizedBox(height: 12),
                  DropdownButtonFormField<String>(
                    value: provider,
                    decoration: const InputDecoration(labelText: 'Provider'),
                    items: ['custom', 'aws', 'gcp', 'azure', 'digitalocean', 'hetzner']
                        .map((p) => DropdownMenuItem(value: p, child: Text(p)))
                        .toList(),
                    onChanged: (v) => setS(() => provider = v ?? provider),
                  ),
                  const SizedBox(height: 20),
                  FilledButton(
                    onPressed: () async {
                      if (!formKey.currentState!.validate()) return;
                      Navigator.pop(ctx);
                      try {
                        await ref.read(dioProvider).post('/api/v1/vms/', data: {
                          'name': nameCtrl.text.trim(),
                          'host_ip': hostCtrl.text.trim(),
                          'ssh_username': userCtrl.text.trim(),
                          'ssh_password': passCtrl.text,
                          'ssh_port': int.tryParse(portCtrl.text) ?? 22,
                          'provider': provider,
                        });
                        _load();
                        _snack('VM added');
                      } catch (e) {
                        _snack('Failed: $e', error: true);
                      }
                    },
                    child: const Text('Add VM'),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }

  Widget _tf(
    TextEditingController ctrl,
    String label, {
    bool required = false,
    TextInputType? keyboardType,
    String? Function(String?)? validator,
  }) =>
      TextFormField(
        controller: ctrl,
        keyboardType: keyboardType,
        decoration: InputDecoration(labelText: label),
        validator: validator ?? (required ? (v) => (v == null || v.trim().isEmpty) ? 'Required' : null : null),
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
        title: const Text('Virtual Machines'),
        actions: [IconButton(icon: const Icon(Icons.refresh), onPressed: _load)],
      ),
      floatingActionButton: FloatingActionButton.extended(
        onPressed: _showAddSheet,
        icon: const Icon(Icons.add),
        label: const Text('Add VM'),
      ),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : _error != null
              ? _errorView(cs)
              : _vms.isEmpty
                  ? _emptyView(cs)
                  : RefreshIndicator(
                      onRefresh: _load,
                      child: ListView.separated(
                        padding: const EdgeInsets.fromLTRB(12, 12, 12, 88),
                        itemCount: _vms.length,
                        separatorBuilder: (_, __) => const SizedBox(height: 8),
                        itemBuilder: (_, i) => _vmCard(_vms[i], cs),
                      ),
                    ),
    );
  }

  Widget _vmCard(Map<String, dynamic> vm, ColorScheme cs) {
    final id       = vm['id'] as int? ?? 0;
    final label    = vm['name']?.toString() ?? vm['label']?.toString() ?? 'Unnamed VM';
    final host     = vm['host_ip']?.toString() ?? vm['host']?.toString() ?? '';
    final port     = vm['ssh_port']?.toString() ?? vm['port']?.toString() ?? '22';
    final username = vm['ssh_username']?.toString() ?? vm['username']?.toString() ?? '';
    final provider = vm['provider']?.toString() ?? '';
    final fp       = vm['ssh_host_key_fingerprint']?.toString() ?? vm['host_key_fingerprint']?.toString() ?? '';
    final trusted  = fp.isNotEmpty;

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
              CircleAvatar(
                radius: 18,
                backgroundColor: (trusted ? Colors.green : Colors.amber).withOpacity(0.15),
                child: Icon(
                  trusted ? Icons.verified_user : Icons.shield_outlined,
                  color: trusted ? Colors.green : Colors.amber,
                  size: 18,
                ),
              ),
              const SizedBox(width: 10),
              Expanded(child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(label, style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 14)),
                  if (provider.isNotEmpty)
                    Text(provider, style: TextStyle(fontSize: 11, color: cs.onSurface.withOpacity(0.4))),
                ],
              )),
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                decoration: BoxDecoration(
                  color: (trusted ? Colors.green : Colors.amber).withOpacity(0.15),
                  borderRadius: BorderRadius.circular(8),
                ),
                child: Text(
                  trusted ? 'TRUSTED' : 'UNTRUSTED',
                  style: TextStyle(
                    fontSize: 10,
                    color: trusted ? Colors.green : Colors.amber,
                    fontWeight: FontWeight.bold,
                  ),
                ),
              ),
            ]),
            if (host.isNotEmpty) ...[
              const SizedBox(height: 6),
              Text(
                '$username@$host:$port',
                style: TextStyle(
                  fontSize: 12,
                  fontFamily: 'monospace',
                  color: cs.onSurface.withOpacity(0.55),
                ),
              ),
            ],
            const SizedBox(height: 8),
            Row(children: [
              if (!trusted)
                TextButton.icon(
                  onPressed: () => _trustKey(id),
                  icon: const Icon(Icons.key, size: 15, color: Colors.amber),
                  label: const Text('Trust Key', style: TextStyle(fontSize: 12, color: Colors.amber)),
                  style: TextButton.styleFrom(padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 4)),
                ),
              const Spacer(),
              IconButton(
                icon: const Icon(Icons.delete_outline, size: 18),
                color: Colors.red[400],
                onPressed: () => _delete(id, label),
                tooltip: 'Remove',
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
          Icon(Icons.dns_outlined, size: 56, color: cs.onSurface.withOpacity(0.2)),
          const SizedBox(height: 12),
          Text('No VMs registered', style: TextStyle(color: cs.onSurface.withOpacity(0.5))),
          const SizedBox(height: 4),
          Text('Tap + to add one', style: TextStyle(fontSize: 12, color: cs.onSurface.withOpacity(0.3))),
        ]),
      );
}
