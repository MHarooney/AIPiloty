import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:dio/dio.dart';

import '../../core/network/api_client.dart';

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
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final dio = ref.read(dioProvider);
      final res = await dio.get('/api/v1/deployments');
      final data = res.data;
      final list = data is List
          ? List<Map<String, dynamic>>.from(
              data.map((e) => Map<String, dynamic>.from(e)))
          : <Map<String, dynamic>>[];
      setState(() {
        _deployments = list;
        _loading = false;
      });
    } on DioException catch (e) {
      setState(() {
        _error = e.response?.data?['detail']?.toString() ??
            e.message ??
            'Failed to load deployments';
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
        // Header
        Container(
          padding: const EdgeInsets.fromLTRB(16, 12, 16, 12),
          decoration: BoxDecoration(
            color: cs.surface,
            border:
                Border(bottom: BorderSide(color: cs.outline.withOpacity(0.1))),
          ),
          child: Row(
            children: [
              Icon(Icons.rocket_launch, color: cs.primary, size: 20),
              const SizedBox(width: 8),
              const Text('Deployments',
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

        // Content
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
                  : _deployments.isEmpty
                      ? Center(
                          child: Column(
                            mainAxisSize: MainAxisSize.min,
                            children: [
                              Icon(Icons.rocket_launch_outlined,
                                  size: 56,
                                  color: cs.onSurface.withOpacity(0.2)),
                              const SizedBox(height: 12),
                              Text('No deployments yet',
                                  style: TextStyle(
                                      color: cs.onSurface.withOpacity(0.5))),
                              const SizedBox(height: 4),
                              Text('Create deployments from the web UI',
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
                            itemCount: _deployments.length,
                            separatorBuilder: (_, __) =>
                                const SizedBox(height: 8),
                            itemBuilder: (context, i) =>
                                _deploymentCard(_deployments[i], cs),
                          ),
                        ),
        ),
      ],
    );
  }

  Widget _deploymentCard(Map<String, dynamic> d, ColorScheme cs) {
    final name = d['name']?.toString() ?? 'Unnamed';
    final status = d['status']?.toString() ?? 'unknown';
    final target = d['target_host']?.toString() ?? d['host']?.toString() ?? '';
    final updatedAt = d['updated_at']?.toString() ?? d['created_at']?.toString() ?? '';

    Color statusColor;
    IconData statusIcon;
    switch (status.toLowerCase()) {
      case 'running':
      case 'deployed':
      case 'active':
        statusColor = Colors.green;
        statusIcon = Icons.check_circle;
        break;
      case 'stopped':
      case 'inactive':
        statusColor = Colors.grey;
        statusIcon = Icons.stop_circle;
        break;
      case 'failed':
      case 'error':
        statusColor = Colors.red;
        statusIcon = Icons.error;
        break;
      case 'deploying':
      case 'building':
        statusColor = Colors.amber;
        statusIcon = Icons.pending;
        break;
      default:
        statusColor = Colors.grey;
        statusIcon = Icons.help_outline;
    }

    return Card(
      elevation: 0,
      color: cs.surfaceContainerHighest.withOpacity(0.5),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
      child: ListTile(
        contentPadding:
            const EdgeInsets.symmetric(horizontal: 16, vertical: 6),
        leading: Icon(statusIcon, color: statusColor, size: 28),
        title: Text(name,
            style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 14)),
        subtitle: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            if (target.isNotEmpty)
              Text(target,
                  style: TextStyle(
                      fontSize: 12, color: cs.onSurface.withOpacity(0.5))),
            Row(
              children: [
                Container(
                  padding:
                      const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                  decoration: BoxDecoration(
                    color: statusColor.withOpacity(0.15),
                    borderRadius: BorderRadius.circular(6),
                  ),
                  child: Text(status.toUpperCase(),
                      style: TextStyle(
                          fontSize: 10,
                          color: statusColor,
                          fontWeight: FontWeight.w600)),
                ),
                if (updatedAt.isNotEmpty) ...[
                  const SizedBox(width: 8),
                  Text(_formatDate(updatedAt),
                      style: TextStyle(
                          fontSize: 10,
                          color: cs.onSurface.withOpacity(0.4))),
                ],
              ],
            ),
          ],
        ),
        isThreeLine: true,
      ),
    );
  }

  String _formatDate(String iso) {
    try {
      final dt = DateTime.parse(iso);
      final diff = DateTime.now().difference(dt);
      if (diff.inMinutes < 1) return 'just now';
      if (diff.inMinutes < 60) return '${diff.inMinutes}m ago';
      if (diff.inHours < 24) return '${diff.inHours}h ago';
      return '${diff.inDays}d ago';
    } catch (_) {
      return iso;
    }
  }
}
