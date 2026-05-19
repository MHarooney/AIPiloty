import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:dio/dio.dart';

import '../../core/network/api_client.dart';

class DatabaseScreen extends ConsumerStatefulWidget {
  const DatabaseScreen({super.key});

  @override
  ConsumerState<DatabaseScreen> createState() => _DatabaseScreenState();
}

class _DatabaseScreenState extends ConsumerState<DatabaseScreen> {
  List<String> _tables = [];
  bool _loadingTables = true;
  String? _tablesError;

  String? _selectedTable;
  List<String> _columns = [];
  List<List<dynamic>> _rows = [];
  int _total = 0;
  int _offset = 0;
  bool _loadingRows = false;
  bool _hasMore = false;
  String? _rowsError;

  @override
  void initState() {
    super.initState();
    _loadTables();
  }

  Future<void> _loadTables() async {
    setState(() { _loadingTables = true; _tablesError = null; });
    try {
      final res = await ref.read(dioProvider).get('/api/v1/database/tables');
      final data = res.data;
      List<String> tables = [];
      if (data is Map && data['tables'] is List) {
        tables = List<String>.from(data['tables'] as List);
      } else if (data is List) {
        tables = List<String>.from(data.map((e) => e.toString()));
      }
      setState(() { _tables = tables; _loadingTables = false; });
    } on DioException catch (e) {
      setState(() { _tablesError = e.response?.data?['detail']?.toString() ?? e.message ?? 'Failed'; _loadingTables = false; });
    } catch (e) {
      setState(() { _tablesError = 'Error: $e'; _loadingTables = false; });
    }
  }

  Future<void> _selectTable(String name) async {
    setState(() {
      _selectedTable = name;
      _columns = [];
      _rows = [];
      _offset = 0;
      _total = 0;
      _hasMore = false;
      _rowsError = null;
    });
    await _loadRows(reset: true);
  }

  Future<void> _loadRows({bool reset = false}) async {
    if (_selectedTable == null) return;
    final offset = reset ? 0 : _offset;
    setState(() { _loadingRows = true; _rowsError = null; });
    try {
      final res = await ref.read(dioProvider).get('/api/v1/database/tables/$_selectedTable', queryParameters: {'limit': 50, 'offset': offset});
      final data = res.data as Map;
      final cols    = List<String>.from(data['columns'] as List? ?? []);
      final newRows = (data['rows'] as List? ?? []).map((r) => r as List<dynamic>).toList();
      final total   = data['total'] as int? ?? newRows.length;
      setState(() {
        _columns     = cols;
        _rows        = reset ? newRows : [..._rows, ...newRows];
        _total       = total;
        _offset      = offset + newRows.length;
        _hasMore     = _offset < total;
        _loadingRows = false;
      });
    } on DioException catch (e) {
      setState(() { _rowsError = e.response?.data?['detail']?.toString() ?? e.message ?? 'Failed'; _loadingRows = false; });
    } catch (e) {
      setState(() { _rowsError = 'Error: $e'; _loadingRows = false; });
    }
  }

  @override
  Widget build(BuildContext context) {
    final cs = Theme.of(context).colorScheme;
    return Scaffold(
      appBar: AppBar(
        title: Text(_selectedTable != null ? 'Table: $_selectedTable' : 'Database'),
        leading: _selectedTable != null
            ? IconButton(
                icon: const Icon(Icons.arrow_back),
                onPressed: () => setState(() {
                  _selectedTable = null;
                  _columns = [];
                  _rows = [];
                }),
              )
            : null,
        actions: [
          IconButton(
            icon: const Icon(Icons.refresh),
            onPressed: _selectedTable != null ? () => _loadRows(reset: true) : _loadTables,
          ),
        ],
      ),
      body: _selectedTable == null ? _tableListView(cs) : _tableDataView(cs),
    );
  }

  Widget _tableListView(ColorScheme cs) {
    if (_loadingTables) return const Center(child: CircularProgressIndicator());
    if (_tablesError != null) {
      return Center(child: Column(mainAxisSize: MainAxisSize.min, children: [
        Icon(Icons.error_outline, color: cs.error, size: 36),
        const SizedBox(height: 8),
        Text(_tablesError!, style: TextStyle(color: cs.error)),
        const SizedBox(height: 12),
        FilledButton.icon(onPressed: _loadTables, icon: const Icon(Icons.refresh), label: const Text('Retry')),
      ]));
    }
    if (_tables.isEmpty) {
      return Center(child: Column(mainAxisSize: MainAxisSize.min, children: [
        Icon(Icons.table_chart_outlined, size: 56, color: cs.onSurface.withOpacity(0.2)),
        const SizedBox(height: 12),
        Text('No tables found', style: TextStyle(color: cs.onSurface.withOpacity(0.5))),
      ]));
    }
    return ListView.separated(
      padding: const EdgeInsets.all(12),
      itemCount: _tables.length,
      separatorBuilder: (_, __) => const SizedBox(height: 6),
      itemBuilder: (_, i) {
        final t = _tables[i];
        return Card(
          elevation: 0,
          color: cs.surfaceContainerHighest.withOpacity(0.45),
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12), side: BorderSide(color: cs.outline.withOpacity(0.12))),
          child: ListTile(
            leading: Icon(Icons.table_rows_outlined, color: cs.primary),
            title: Text(t, style: const TextStyle(fontFamily: 'monospace', fontSize: 13)),
            trailing: const Icon(Icons.chevron_right),
            onTap: () => _selectTable(t),
          ),
        );
      },
    );
  }

  Widget _tableDataView(ColorScheme cs) {
    if (_loadingRows && _rows.isEmpty) return const Center(child: CircularProgressIndicator());
    if (_rowsError != null && _rows.isEmpty) {
      return Center(child: Column(mainAxisSize: MainAxisSize.min, children: [
        Icon(Icons.error_outline, color: cs.error, size: 36),
        const SizedBox(height: 8),
        Text(_rowsError!, style: TextStyle(color: cs.error)),
        const SizedBox(height: 12),
        FilledButton.icon(onPressed: () => _loadRows(reset: true), icon: const Icon(Icons.refresh), label: const Text('Retry')),
      ]));
    }
    if (_columns.isEmpty && !_loadingRows) {
      return Center(child: Text('No data', style: TextStyle(color: cs.onSurface.withOpacity(0.4))));
    }
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 12, 16, 6),
          child: Text('$_total row${_total != 1 ? 's' : ''} total', style: TextStyle(fontSize: 12, color: cs.onSurface.withOpacity(0.5))),
        ),
        Expanded(
          child: SingleChildScrollView(
            child: SingleChildScrollView(
              scrollDirection: Axis.horizontal,
              child: DataTable(
                headingRowHeight: 36,
                dataRowMinHeight: 32,
                dataRowMaxHeight: 40,
                columnSpacing: 20,
                columns: _columns.map((c) => DataColumn(
                  label: Text(c, style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 12, fontFamily: 'monospace')),
                )).toList(),
                rows: _rows.map((row) => DataRow(
                  cells: List.generate(_columns.length, (i) {
                    final val = i < row.length ? row[i] : null;
                    return DataCell(Text(
                      val?.toString() ?? 'null',
                      style: TextStyle(fontSize: 11, fontFamily: 'monospace', color: val == null ? Colors.grey : null),
                      overflow: TextOverflow.ellipsis,
                    ));
                  }),
                )).toList(),
              ),
            ),
          ),
        ),
        if (_hasMore) Padding(
          padding: const EdgeInsets.all(12),
          child: Center(
            child: _loadingRows
                ? const CircularProgressIndicator()
                : FilledButton.tonal(
                    onPressed: _loadRows,
                    child: Text('Load more ($_offset/$_total)'),
                  ),
          ),
        ),
      ],
    );
  }
}
