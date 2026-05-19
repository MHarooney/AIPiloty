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
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final dio = ref.read(dioProvider);
      final res = await dio.get('/api/v1/vms');
      final data = res.data;
      final list = data is List
          ? List<Map<String, dynamic>>.from(
              data.map((e) => Map<String, dynamic>.from(e)))
          : <Map<String, dynamic>>[];
      setState(() {
        _vms = list;
        _loading = false;
      });
    } on DioException catch (e) {
      setState(() {
        _error = e.response?.data?['detail']?.toString() ??
            e.message ??
            'Failed to load VMs';
        _loading = false;
      });
    } catch (e) {
      setState(() {
        _error = 'Error: $e';
        _loading = false;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final cs = Theme.of(context).colorScheme;

    return Column(
      children: [
        Container(
          padding: const EdgeInsets.fromLTRB(16, 12, 16, 12),
          decoration: BoxDecoration(
            color: cs.surface,
            border:
                Border(bottom: BorderSide(color: cs.outline.withOpacity(0.1))),
          ),
          child: Row(
            children: [
              Icon(Icons.dns, color: cs.primary, size: 20),
              const SizedBox(width: 8),
              const Text('Virtual Machines',
                  style: TextStyle(fontSize: 16, fontWeight: FontWeight.w600)),
              const Spacer(),
              IconButton(
                icon: const Icon(Icons.refresh, size: 20),
                onPressed: _load,
                tooltip: 'Refresh',
              ),
            ],
          ),
        ),
        Expanded(
          child: _loading
              ? const Center(child: CircularProgressIndicator())
              : _error != null
                  ? Center(
                      child: Padding(
                        padding: const EdgeInsets.all(24),
                        child: Column(
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            Icon(Icons.error_outline,
                                color: cs.error, size: 40),
                            const SizedBox(height: 12),
                            Text(_error!,
                                style: TextStyle(color: cs.error),
                                textAlign: TextAlign.center),
                            const SizedBox(height: 12),
                            TextButton(
                                onPressed: _load,
                                child: const Text('Retry')),
                          ],
                        ),
                      ),
                    )
                  : _vms.isEmpty
                      ? Center(
                          child: Column(
                            mainAxisSize: MainAxisSize.min,
                            children: [
                              Icon(Icons.dns_outlined,
                                  size: 56,
                                  color: cs.onSurface.withOpacity(0.2)),
                              const SizedBox(height: 12),
                              Text('No VMs registered',
                                  style: TextStyle(
                                      color: cs.onSurface.withOpacity(0.5))),
                              const SizedBox(height: 4),
                              Text('Add VMs from the web UI',
                                  style: TextStyle(
                                      fontSize: 12,
                                      color: cs.onSurface.withOpacity(0.3))),
                            ],
                          ),
                        )
                      : RefreshIndicator(
                          onRefresh: _load,
                          child: ListView.separated(
                            padding: const EdgeInsets.all(12),
                            itemCount: _vms.length,
                            separatorBuilder: (_, __) =>
                                const SizedBox(height: 8),
                            itemBuilder: (context, i) =>
                                _vmCard(_vms[i], cs),
                          ),
                        ),
        ),
      ],
    );
  }

  Widget _vmCard(Map<String, dynamic> vm, ColorScheme cs) {
    final label = vm['label']?.toString() ?? vm['name']?.toString() ?? 'Unnamed VM';
    final host = vm['host']?.toString() ?? '';
    final port = vm['port']?.toString() ?? '22';
    final username = vm['username']?.toString() ?? '';
    final trusted = vm['host_key_fingerprint'] != null &&
        (vm['host_key_fingerprint']?.toString() ?? '').isNotEmpty;

    return Card(
      elevation: 0,
      color: cs.surfaceContainerHighest.withOpacity(0.5),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
      child: ListTile(
        contentPadding:
            const EdgeInsets.symmetric(horizontal: 16, vertical: 6),
        leading: CircleAvatar(
          backgroundColor: trusted
              ? Colors.green.withOpacity(0.15)
              : Colors.amber.withOpacity(0.15),
          child: Icon(
            trusted ? Icons.verified_user : Icons.shield_outlined,
            color: trusted ? Colors.green : Colors.amber,
            size: 22,
          ),
        ),
        title: Text(label,
            style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 14)),
        subtitle: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            if (host.isNotEmpty)
              Text('$username@$host:$port',
                  style: TextStyle(
                      fontSize: 12,
                      fontFamily: 'monospace',
                      color: cs.onSurface.withOpacity(0.6))),
            const SizedBox(height: 4),
            Row(
              children: [
                Container(
                  padding:
                      const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                  decoration: BoxDecoration(
                    color: trusted
                        ? Colors.green.withOpacity(0.15)
                        : Colors.amber.withOpacity(0.15),
                    borderRadius: BorderRadius.circular(6),
                  ),
                  child: Text(
                    trusted ? 'TRUSTED' : 'UNTRUSTED',
                    style: TextStyle(
                        fontSize: 10,
                        color: trusted ? Colors.green : Colors.amber,
                        fontWeight: FontWeight.w600),
                  ),
                ),
              ],
            ),
          ],
        ),
        isThreeLine: true,
      ),
    );
  }
}
