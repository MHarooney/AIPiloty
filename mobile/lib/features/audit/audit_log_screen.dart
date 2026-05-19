import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/network/api_client.dart';

/// Audit log screen — displays system action history from the backend.
class AuditLogScreen extends ConsumerStatefulWidget {
  const AuditLogScreen({super.key});

  @override
  ConsumerState<AuditLogScreen> createState() => _AuditLogScreenState();
}

class _AuditLogScreenState extends ConsumerState<AuditLogScreen> {
  List<dynamic> _entries = [];
  bool _loading = false;
  String? _error;
  String? _selectedAction;
  List<String> _actions = [];

  @override
  void initState() {
    super.initState();
    _loadActions();
    _loadEntries();
  }

  Future<void> _loadActions() async {
    try {
      final dio = ref.read(dioProvider);
      final resp = await dio.get('/api/v1/audit-log/actions');
      setState(() {
        _actions = List<String>.from(resp.data['actions'] ?? []);
      });
    } catch (_) {}
  }

  Future<void> _loadEntries() async {
    setState(() {
      _loading = true;
      _error = null;
    });

    try {
      final dio = ref.read(dioProvider);
      final params = <String, dynamic>{'limit': 100};
      if (_selectedAction != null) params['action'] = _selectedAction;

      final resp = await dio.get('/api/v1/audit-log', queryParameters: params);
      setState(() {
        _entries = resp.data['entries'] ?? [];
      });
    } on DioException catch (e) {
      setState(() => _error = e.message ?? 'Failed to load audit log');
    } finally {
      setState(() => _loading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return Scaffold(
      appBar: AppBar(
        title: const Text('Audit Log'),
        actions: [
          if (_actions.isNotEmpty)
            PopupMenuButton<String?>(
              icon: const Icon(Icons.filter_list),
              tooltip: 'Filter by action',
              onSelected: (action) {
                setState(() => _selectedAction = action);
                _loadEntries();
              },
              itemBuilder: (ctx) => [
                const PopupMenuItem<String?>(
                  value: null,
                  child: Text('All actions'),
                ),
                ..._actions.map((a) => PopupMenuItem<String?>(
                      value: a,
                      child: Text(a, style: const TextStyle(fontSize: 13)),
                    )),
              ],
            ),
        ],
      ),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : _error != null
              ? Center(
                  child: Column(
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: [
                      Icon(Icons.error_outline, size: 48, color: theme.colorScheme.error),
                      const SizedBox(height: 12),
                      Text(_error!, style: TextStyle(color: theme.colorScheme.error)),
                      const SizedBox(height: 16),
                      FilledButton(
                        onPressed: _loadEntries,
                        child: const Text('Retry'),
                      ),
                    ],
                  ),
                )
              : _entries.isEmpty
                  ? Center(
                      child: Column(
                        mainAxisAlignment: MainAxisAlignment.center,
                        children: [
                          Icon(Icons.policy_outlined, size: 48,
                              color: theme.colorScheme.onSurface.withValues(alpha: 0.3)),
                          const SizedBox(height: 12),
                          Text('No audit entries yet',
                              style: theme.textTheme.bodyLarge?.copyWith(
                                color: theme.colorScheme.onSurface.withValues(alpha: 0.5),
                              )),
                        ],
                      ),
                    )
                  : RefreshIndicator(
                      onRefresh: _loadEntries,
                      child: ListView.separated(
                        itemCount: _entries.length,
                        separatorBuilder: (_, __) => const Divider(height: 1),
                        itemBuilder: (ctx, i) => _buildEntry(_entries[i], theme),
                      ),
                    ),
    );
  }

  Widget _buildEntry(dynamic entry, ThemeData theme) {
    final action = entry['action'] as String? ?? '';
    final user = entry['user'] as String? ?? 'system';
    final resource = entry['resource'] as String? ?? '';
    final createdAt = entry['created_at'] as String? ?? '';
    final details = entry['details'];
    final statusCode = details is Map ? details['status_code'] : null;

    final isError = statusCode != null && statusCode >= 400;
    final method = action.split(' ').first;

    Color methodColor;
    switch (method) {
      case 'POST':
        methodColor = Colors.green;
        break;
      case 'PUT':
      case 'PATCH':
        methodColor = Colors.amber;
        break;
      case 'DELETE':
        methodColor = Colors.red;
        break;
      default:
        methodColor = Colors.blue;
    }

    return ListTile(
      leading: CircleAvatar(
        radius: 18,
        backgroundColor: methodColor.withValues(alpha: 0.15),
        child: Text(
          method.substring(0, method.length > 3 ? 3 : method.length),
          style: TextStyle(fontSize: 10, fontWeight: FontWeight.bold, color: methodColor),
        ),
      ),
      title: Text(
        resource,
        style: const TextStyle(fontSize: 13, fontFamily: 'monospace'),
        maxLines: 1,
        overflow: TextOverflow.ellipsis,
      ),
      subtitle: Text(
        '$user • ${_formatTime(createdAt)}'
        '${statusCode != null ? ' • $statusCode' : ''}',
        style: TextStyle(
          fontSize: 11,
          color: isError
              ? theme.colorScheme.error
              : theme.colorScheme.onSurface.withValues(alpha: 0.5),
        ),
      ),
      trailing: isError
          ? Icon(Icons.warning_amber, size: 18, color: theme.colorScheme.error)
          : null,
    );
  }

  String _formatTime(String iso) {
    try {
      final dt = DateTime.parse(iso);
      final now = DateTime.now();
      final diff = now.difference(dt);
      if (diff.inMinutes < 1) return 'just now';
      if (diff.inMinutes < 60) return '${diff.inMinutes}m ago';
      if (diff.inHours < 24) return '${diff.inHours}h ago';
      if (diff.inDays < 7) return '${diff.inDays}d ago';
      return '${dt.month}/${dt.day}';
    } catch (_) {
      return iso;
    }
  }
}
