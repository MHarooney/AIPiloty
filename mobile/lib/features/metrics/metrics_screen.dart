import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:dio/dio.dart';

import '../../core/network/api_client.dart';

class MetricsScreen extends ConsumerStatefulWidget {
  const MetricsScreen({super.key});

  @override
  ConsumerState<MetricsScreen> createState() => _MetricsScreenState();
}

class _MetricsScreenState extends ConsumerState<MetricsScreen> with SingleTickerProviderStateMixin {
  late TabController _tab;

  @override
  void initState() {
    super.initState();
    _tab = TabController(length: 2, vsync: this);
  }

  @override
  void dispose() {
    _tab.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Metrics & Logs'),
        bottom: TabBar(
          controller: _tab,
          tabs: const [Tab(text: 'Metrics'), Tab(text: 'Logs')],
        ),
      ),
      body: TabBarView(
        controller: _tab,
        children: [_MetricsTab(), _LogsTab()],
      ),
    );
  }
}

// ── Metrics Tab ───────────────────────────────────────────────────────────────

class _MetricsTab extends ConsumerStatefulWidget {
  @override
  ConsumerState<_MetricsTab> createState() => _MetricsTabState();
}

class _MetricsTabState extends ConsumerState<_MetricsTab> {
  List<_MetricRow> _rows = [];
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
      final res  = await ref.read(dioProvider).get('/api/v1/metrics/');
      final data = res.data;
      final rows = <_MetricRow>[];

      if (data is Map) {
        final timings  = data['timings']  as Map? ?? {};
        final counters = data['counters'] as Map? ?? {};

        for (final entry in timings.entries) {
          final ep = entry.key.toString();
          final t  = entry.value is Map ? entry.value as Map : {};
          rows.add(_MetricRow(
            endpoint: ep,
            count:    (counters[ep] ?? t['count'] ?? 0).toString(),
            p50:      _fmt(t['p50'] ?? t['p50ms']),
            p95:      _fmt(t['p95'] ?? t['p95ms']),
            avg:      _fmt(t['avg'] ?? t['mean']),
          ));
        }

        if (rows.isEmpty && counters.isNotEmpty) {
          for (final entry in counters.entries) {
            rows.add(_MetricRow(endpoint: entry.key.toString(), count: entry.value.toString(), p50: '-', p95: '-', avg: '-'));
          }
        }
      }

      setState(() { _rows = rows; _loading = false; });
    } on DioException catch (e) {
      setState(() { _error = e.response?.data?['detail']?.toString() ?? e.message ?? 'Failed'; _loading = false; });
    } catch (e) {
      setState(() { _error = 'Error: $e'; _loading = false; });
    }
  }

  String _fmt(dynamic v) {
    if (v == null) return '-';
    final d = double.tryParse(v.toString());
    if (d == null) return v.toString();
    return '${d.toStringAsFixed(1)}ms';
  }

  @override
  Widget build(BuildContext context) {
    final cs = Theme.of(context).colorScheme;
    if (_loading) return const Center(child: CircularProgressIndicator());
    if (_error != null) {
      return Center(child: Column(mainAxisSize: MainAxisSize.min, children: [
        Icon(Icons.error_outline, color: cs.error, size: 36),
        const SizedBox(height: 8),
        Text(_error!, style: TextStyle(color: cs.error)),
        const SizedBox(height: 12),
        FilledButton.icon(onPressed: _load, icon: const Icon(Icons.refresh), label: const Text('Retry')),
      ]));
    }
    if (_rows.isEmpty) {
      return Center(child: Column(mainAxisSize: MainAxisSize.min, children: [
        Icon(Icons.bar_chart_outlined, size: 56, color: cs.onSurface.withOpacity(0.2)),
        const SizedBox(height: 12),
        Text('No metrics data', style: TextStyle(color: cs.onSurface.withOpacity(0.5))),
        const SizedBox(height: 12),
        FilledButton.icon(onPressed: _load, icon: const Icon(Icons.refresh), label: const Text('Refresh')),
      ]));
    }
    return RefreshIndicator(
      onRefresh: _load,
      child: SingleChildScrollView(
        child: SingleChildScrollView(
          scrollDirection: Axis.horizontal,
          child: DataTable(
            headingRowHeight: 36,
            dataRowMinHeight: 32,
            dataRowMaxHeight: 36,
            columnSpacing: 16,
            columns: const [
              DataColumn(label: Text('Endpoint',   style: TextStyle(fontWeight: FontWeight.bold, fontSize: 12))),
              DataColumn(label: Text('Count',      style: TextStyle(fontWeight: FontWeight.bold, fontSize: 12))),
              DataColumn(label: Text('P50',        style: TextStyle(fontWeight: FontWeight.bold, fontSize: 12))),
              DataColumn(label: Text('P95',        style: TextStyle(fontWeight: FontWeight.bold, fontSize: 12))),
              DataColumn(label: Text('Avg',        style: TextStyle(fontWeight: FontWeight.bold, fontSize: 12))),
            ],
            rows: _rows.map((r) => DataRow(cells: [
              DataCell(Text(r.endpoint, style: const TextStyle(fontSize: 11, fontFamily: 'monospace'), overflow: TextOverflow.ellipsis)),
              DataCell(Text(r.count,    style: const TextStyle(fontSize: 11))),
              DataCell(Text(r.p50,      style: const TextStyle(fontSize: 11))),
              DataCell(Text(r.p95,      style: const TextStyle(fontSize: 11))),
              DataCell(Text(r.avg,      style: const TextStyle(fontSize: 11))),
            ])).toList(),
          ),
        ),
      ),
    );
  }
}

class _MetricRow {
  final String endpoint, count, p50, p95, avg;
  const _MetricRow({required this.endpoint, required this.count, required this.p50, required this.p95, required this.avg});
}

// ── Logs Tab ──────────────────────────────────────────────────────────────────

class _LogsTab extends ConsumerStatefulWidget {
  @override
  ConsumerState<_LogsTab> createState() => _LogsTabState();
}

class _LogsTabState extends ConsumerState<_LogsTab> {
  List<Map<String, dynamic>> _logs = [];
  bool _loading = true;
  String? _error;

  static const _levelColors = {
    'error':   Colors.red,
    'warning': Colors.orange,
    'warn':    Colors.orange,
    'info':    Colors.blue,
    'debug':   Colors.grey,
    'success': Colors.green,
  };

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() { _loading = true; _error = null; });
    try {
      final res  = await ref.read(dioProvider).get('/api/v1/logs/', queryParameters: {'limit': 50});
      final data = res.data;
      List raw = data is List ? data : (data is Map ? (data['items'] ?? data['logs'] ?? []) as List : []);
      setState(() {
        _logs = raw.map((e) => Map<String, dynamic>.from(e as Map)).toList();
        _loading = false;
      });
    } on DioException catch (e) {
      setState(() { _error = e.response?.data?['detail']?.toString() ?? e.message ?? 'Failed'; _loading = false; });
    } catch (e) {
      setState(() { _error = 'Error: $e'; _loading = false; });
    }
  }

  @override
  Widget build(BuildContext context) {
    final cs = Theme.of(context).colorScheme;
    if (_loading) return const Center(child: CircularProgressIndicator());
    if (_error != null) {
      return Center(child: Column(mainAxisSize: MainAxisSize.min, children: [
        Icon(Icons.error_outline, color: cs.error, size: 36),
        const SizedBox(height: 8),
        Text(_error!, style: TextStyle(color: cs.error)),
        const SizedBox(height: 12),
        FilledButton.icon(onPressed: _load, icon: const Icon(Icons.refresh), label: const Text('Retry')),
      ]));
    }
    if (_logs.isEmpty) {
      return Center(child: Column(mainAxisSize: MainAxisSize.min, children: [
        Icon(Icons.list_alt_outlined, size: 56, color: cs.onSurface.withOpacity(0.2)),
        const SizedBox(height: 12),
        Text('No logs', style: TextStyle(color: cs.onSurface.withOpacity(0.5))),
        const SizedBox(height: 12),
        FilledButton.icon(onPressed: _load, icon: const Icon(Icons.refresh), label: const Text('Refresh')),
      ]));
    }
    return RefreshIndicator(
      onRefresh: _load,
      child: ListView.builder(
        padding: const EdgeInsets.symmetric(vertical: 6),
        itemCount: _logs.length,
        itemBuilder: (_, i) {
          final log   = _logs[i];
          final level = (log['level']?.toString() ?? 'info').toLowerCase();
          final color = _levelColors[level] ?? Colors.grey;
          final ts    = log['timestamp']?.toString() ?? log['created_at']?.toString() ?? '';
          final event = log['event']?.toString() ?? log['message']?.toString() ?? log['msg']?.toString() ?? '';

          return Padding(
            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 3),
            child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                decoration: BoxDecoration(color: color.withOpacity(0.15), borderRadius: BorderRadius.circular(4)),
                child: Text(level.toUpperCase(), style: TextStyle(fontSize: 10, color: color, fontWeight: FontWeight.bold)),
              ),
              const SizedBox(width: 8),
              Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                if (ts.isNotEmpty) Text(_shortTs(ts), style: TextStyle(fontSize: 10, color: cs.onSurface.withOpacity(0.4))),
                Text(event, style: const TextStyle(fontSize: 12)),
              ])),
            ]),
          );
        },
      ),
    );
  }

  String _shortTs(String ts) {
    try {
      final dt = DateTime.parse(ts).toLocal();
      return '${dt.hour.toString().padLeft(2, '0')}:${dt.minute.toString().padLeft(2, '0')}:${dt.second.toString().padLeft(2, '0')}';
    } catch (_) {
      return ts.length > 19 ? ts.substring(11, 19) : ts;
    }
  }
}
