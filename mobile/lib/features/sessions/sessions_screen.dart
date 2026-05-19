import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:dio/dio.dart';

import '../../core/network/api_client.dart';

class SessionsScreen extends ConsumerStatefulWidget {
  const SessionsScreen({super.key});

  @override
  ConsumerState<SessionsScreen> createState() => _SessionsScreenState();
}

class _SessionsScreenState extends ConsumerState<SessionsScreen> {
  List<dynamic>? _sessions;
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
      final resp = await dio.get('/api/v1/chat/sessions');
      setState(() {
        _sessions = resp.data is List ? resp.data as List : [];
        _loading = false;
      });
    } on DioException catch (e) {
      setState(() {
        _error = e.message ?? 'Failed to load sessions';
        _loading = false;
      });
    } catch (e) {
      setState(() {
        _error = e.toString();
        _loading = false;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final cs = Theme.of(context).colorScheme;

    return Scaffold(
      appBar: AppBar(
        title: const Text('Sessions'),
        actions: [
          IconButton(
            icon: const Icon(Icons.refresh),
            onPressed: _load,
          ),
        ],
      ),
      body: _buildBody(cs),
    );
  }

  Widget _buildBody(ColorScheme cs) {
    if (_loading) {
      return const Center(child: CircularProgressIndicator());
    }

    if (_error != null) {
      return Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(Icons.error_outline, size: 48, color: cs.error),
            const SizedBox(height: 8),
            Text(_error!, style: TextStyle(color: cs.error)),
            const SizedBox(height: 16),
            FilledButton.icon(
              onPressed: _load,
              icon: const Icon(Icons.refresh),
              label: const Text('Retry'),
            ),
          ],
        ),
      );
    }

    if (_sessions == null || _sessions!.isEmpty) {
      return Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(Icons.history,
                size: 48, color: cs.onSurface.withValues(alpha: 0.3)),
            const SizedBox(height: 8),
            Text(
              'No sessions yet',
              style: TextStyle(color: cs.onSurface.withValues(alpha: 0.5)),
            ),
          ],
        ),
      );
    }

    return RefreshIndicator(
      onRefresh: _load,
      child: ListView.separated(
        padding: const EdgeInsets.all(12),
        itemCount: _sessions!.length,
        separatorBuilder: (_, __) => const SizedBox(height: 8),
        itemBuilder: (context, i) {
          final s = _sessions![i];
          final key = s['session_key'] ?? s['key'] ?? 'Unknown';
          final msgCount = s['message_count'] ?? s['messages'] ?? 0;
          final created = s['created_at'] ?? s['timestamp'] ?? '';

          return Card(
            child: ListTile(
              leading: CircleAvatar(
                backgroundColor: cs.primaryContainer,
                child: Icon(Icons.chat, color: cs.onPrimaryContainer),
              ),
              title: Text(
                key.toString().length > 20
                    ? '${key.toString().substring(0, 20)}...'
                    : key.toString(),
                style: const TextStyle(fontWeight: FontWeight.w500),
              ),
              subtitle: Text('$msgCount messages • $created'),
              trailing: const Icon(Icons.chevron_right),
              onTap: () {
                ScaffoldMessenger.of(context).showSnackBar(
                  SnackBar(
                      content: Text('Session: $key\nUse Chat tab to resume.')),
                );
              },
            ),
          );
        },
      ),
    );
  }
}
