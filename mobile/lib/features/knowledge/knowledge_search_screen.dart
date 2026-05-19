import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:dio/dio.dart';

import '../../core/network/api_client.dart';

class KnowledgeSearchScreen extends ConsumerStatefulWidget {
  const KnowledgeSearchScreen({super.key});

  @override
  ConsumerState<KnowledgeSearchScreen> createState() =>
      _KnowledgeSearchScreenState();
}

class _KnowledgeSearchScreenState
    extends ConsumerState<KnowledgeSearchScreen> {
  final _controller = TextEditingController();
  List<Map<String, dynamic>> _results = [];
  bool _loading = false;
  String? _error;
  String _mode = 'hybrid';
  bool _hasSearched = false;

  Future<void> _search() async {
    final query = _controller.text.trim();
    if (query.isEmpty) return;

    setState(() {
      _loading = true;
      _error = null;
      _hasSearched = true;
    });

    try {
      final dio = ref.read(dioProvider);
      final res = await dio.get('/api/v1/knowledge/search', queryParameters: {
        'query': query,
        'mode': _mode,
        'limit': 20,
      });

      final data = res.data;
      final list = data is Map && data['results'] is List
          ? List<Map<String, dynamic>>.from(
              (data['results'] as List).map((e) => Map<String, dynamic>.from(e as Map)))
          : <Map<String, dynamic>>[];

      setState(() {
        _results = list;
        _loading = false;
      });
    } on DioException catch (e) {
      setState(() {
        _error = e.response?.data?['detail']?.toString() ??
            e.message ??
            'Search failed';
        _loading = false;
      });
    } catch (e) {
      setState(() {
        _error = 'Search failed: $e';
        _loading = false;
      });
    }
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final cs = Theme.of(context).colorScheme;

    return DefaultTabController(
      length: 2,
      child: Column(
        children: [
          // Tab bar header
          Container(
            color: cs.surface,
            child: const TabBar(
              tabs: [
                Tab(icon: Icon(Icons.search, size: 18), text: 'Search'),
                Tab(icon: Icon(Icons.library_books, size: 18), text: 'Documents'),
              ],
            ),
          ),
          Expanded(
            child: TabBarView(
              children: [
                _SearchTab(
                  controller: _controller,
                  loading: _loading,
                  error: _error,
                  results: _results,
                  hasSearched: _hasSearched,
                  mode: _mode,
                  onSearch: _search,
                  onModeChanged: (m) => setState(() => _mode = m),
                  onShowDetail: _showDetail,
                  cs: cs,
                ),
                _DocumentsTab(key: const ValueKey('docs-tab')),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _modeChip(String value, String label, ColorScheme cs) {
    final selected = _mode == value;
    return ChoiceChip(
      label: Text(label, style: const TextStyle(fontSize: 12)),
      selected: selected,
      onSelected: (_) => setState(() => _mode = value),
      visualDensity: VisualDensity.compact,
      selectedColor: cs.primaryContainer,
    );
  }

  Widget _resultCard(Map<String, dynamic> result, ColorScheme cs) {
    final title = result['title']?.toString() ?? 'Untitled';
    final content = result['content']?.toString() ?? '';
    final source = result['source']?.toString() ?? result['source_type']?.toString() ?? '';
    final score = result['score'];
    final tags = result['tags'] is List
        ? List<String>.from(result['tags'] as List)
        : <String>[];

    return Card(
      elevation: 0,
      color: cs.surfaceContainerHighest.withOpacity(0.5),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
      child: InkWell(
        borderRadius: BorderRadius.circular(12),
        onTap: () => _showDetail(result),
        child: Padding(
          padding: const EdgeInsets.all(14),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  Expanded(
                    child: Text(title,
                        style: const TextStyle(
                            fontWeight: FontWeight.w600, fontSize: 14),
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis),
                  ),
                  if (score != null)
                    Container(
                      padding: const EdgeInsets.symmetric(
                          horizontal: 6, vertical: 2),
                      decoration: BoxDecoration(
                        color: cs.primaryContainer,
                        borderRadius: BorderRadius.circular(8),
                      ),
                      child: Text(
                        '${(score is num ? (score * 100).toInt() : score)}%',
                        style: TextStyle(
                            fontSize: 10,
                            color: cs.onPrimaryContainer,
                            fontWeight: FontWeight.w600),
                      ),
                    ),
                ],
              ),
              if (source.isNotEmpty) ...[
                const SizedBox(height: 4),
                Text(source,
                    style: TextStyle(
                        fontSize: 11,
                        color: cs.onSurface.withOpacity(0.5))),
              ],
              if (content.isNotEmpty) ...[
                const SizedBox(height: 8),
                Text(content,
                    maxLines: 3,
                    overflow: TextOverflow.ellipsis,
                    style: TextStyle(
                        fontSize: 13,
                        color: cs.onSurface.withOpacity(0.7),
                        height: 1.4)),
              ],
              if (tags.isNotEmpty) ...[
                const SizedBox(height: 8),
                Wrap(
                  spacing: 4,
                  runSpacing: 4,
                  children: tags
                      .map((t) => Chip(
                            label: Text(t,
                                style: const TextStyle(fontSize: 10)),
                            visualDensity: VisualDensity.compact,
                            padding: EdgeInsets.zero,
                            materialTapTargetSize:
                                MaterialTapTargetSize.shrinkWrap,
                          ))
                      .toList(),
                ),
              ],
            ],
          ),
        ),
      ),
    );
  }

  void _showDetail(Map<String, dynamic> result) {
    final title = result['title']?.toString() ?? 'Untitled';
    final content = result['content']?.toString() ?? '';
    final source = result['source']?.toString() ?? '';

    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      shape: const RoundedRectangleBorder(
          borderRadius: BorderRadius.vertical(top: Radius.circular(20))),
      builder: (ctx) => DraggableScrollableSheet(
        initialChildSize: 0.7,
        maxChildSize: 0.95,
        minChildSize: 0.3,
        expand: false,
        builder: (_, scrollController) => Padding(
          padding: const EdgeInsets.fromLTRB(20, 12, 20, 20),
          child: ListView(
            controller: scrollController,
            children: [
              Center(
                child: Container(
                  width: 40,
                  height: 4,
                  decoration: BoxDecoration(
                    color: Colors.grey[400],
                    borderRadius: BorderRadius.circular(2),
                  ),
                ),
              ),
              const SizedBox(height: 16),
              Text(title,
                  style: const TextStyle(
                      fontSize: 18, fontWeight: FontWeight.bold)),
              if (source.isNotEmpty) ...[
                const SizedBox(height: 6),
                Text(source,
                    style: TextStyle(
                        fontSize: 12,
                        color: Theme.of(ctx)
                            .colorScheme
                            .onSurface
                            .withOpacity(0.5))),
              ],
              const SizedBox(height: 16),
              SelectableText(content,
                  style: const TextStyle(fontSize: 14, height: 1.6)),
            ],
          ),
        ),
      ),
    );
  }
}

// ── Search tab ────────────────────────────────────────────────────────────────

class _SearchTab extends StatelessWidget {
  const _SearchTab({
    required this.controller,
    required this.loading,
    required this.error,
    required this.results,
    required this.hasSearched,
    required this.mode,
    required this.onSearch,
    required this.onModeChanged,
    required this.onShowDetail,
    required this.cs,
  });

  final TextEditingController controller;
  final bool loading;
  final String? error;
  final List<Map<String, dynamic>> results;
  final bool hasSearched;
  final String mode;
  final VoidCallback onSearch;
  final ValueChanged<String> onModeChanged;
  final void Function(Map<String, dynamic>) onShowDetail;
  final ColorScheme cs;

  @override
  Widget build(BuildContext context) {
    return Column(
      children: [
        Container(
          padding: const EdgeInsets.fromLTRB(16, 8, 16, 8),
          decoration: BoxDecoration(
            color: cs.surface,
            border: Border(bottom: BorderSide(color: cs.outline.withOpacity(0.1))),
          ),
          child: Column(
            children: [
              Row(
                children: [
                  Expanded(
                    child: TextField(
                      controller: controller,
                      decoration: InputDecoration(
                        hintText: 'Search knowledge base…',
                        prefixIcon: const Icon(Icons.search, size: 20),
                        isDense: true,
                        filled: true,
                        fillColor: cs.surfaceContainerHighest.withOpacity(0.5),
                        border: OutlineInputBorder(
                          borderRadius: BorderRadius.circular(12),
                          borderSide: BorderSide.none,
                        ),
                        contentPadding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
                      ),
                      textInputAction: TextInputAction.search,
                      onSubmitted: (_) => onSearch(),
                    ),
                  ),
                  const SizedBox(width: 8),
                  FilledButton.tonal(
                    onPressed: loading ? null : onSearch,
                    child: loading
                        ? const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2))
                        : const Text('Search'),
                  ),
                ],
              ),
              const SizedBox(height: 8),
              Row(
                children: ['hybrid', 'semantic', 'keyword'].map((m) => Padding(
                  padding: const EdgeInsets.only(right: 6),
                  child: ChoiceChip(
                    label: Text(m[0].toUpperCase() + m.substring(1), style: const TextStyle(fontSize: 12)),
                    selected: mode == m,
                    onSelected: (_) => onModeChanged(m),
                    visualDensity: VisualDensity.compact,
                    selectedColor: cs.primaryContainer,
                  ),
                )).toList(),
              ),
            ],
          ),
        ),
        Expanded(
          child: loading
              ? const Center(child: CircularProgressIndicator())
              : error != null
                  ? Center(
                      child: Column(mainAxisSize: MainAxisSize.min, children: [
                        Icon(Icons.error_outline, color: cs.error, size: 40),
                        const SizedBox(height: 12),
                        Text(error!, style: TextStyle(color: cs.error), textAlign: TextAlign.center),
                        const SizedBox(height: 12),
                        TextButton(onPressed: onSearch, child: const Text('Retry')),
                      ]),
                    )
                  : !hasSearched
                      ? Center(
                          child: Column(mainAxisSize: MainAxisSize.min, children: [
                            Icon(Icons.library_books_outlined, size: 56, color: cs.onSurface.withOpacity(0.2)),
                            const SizedBox(height: 12),
                            Text('Search your knowledge base', style: TextStyle(color: cs.onSurface.withOpacity(0.5))),
                            const SizedBox(height: 4),
                            Text('Find documents, code, and notes', style: TextStyle(fontSize: 12, color: cs.onSurface.withOpacity(0.3))),
                          ]),
                        )
                      : results.isEmpty
                          ? Center(child: Text('No results found', style: TextStyle(color: cs.onSurface.withOpacity(0.5))))
                          : ListView.separated(
                              padding: const EdgeInsets.all(12),
                              itemCount: results.length,
                              separatorBuilder: (_, __) => const SizedBox(height: 8),
                              itemBuilder: (_, i) => _resultCard(results[i], cs, onShowDetail),
                            ),
        ),
      ],
    );
  }

  static Widget _resultCard(Map<String, dynamic> result, ColorScheme cs, void Function(Map<String, dynamic>) onTap) {
    final title = result['title']?.toString() ?? 'Untitled';
    final content = result['content']?.toString() ?? '';
    final source = result['source']?.toString() ?? result['source_type']?.toString() ?? '';
    final score = result['score'];

    return Card(
      elevation: 0,
      color: cs.surfaceContainerHighest.withOpacity(0.5),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
      child: InkWell(
        borderRadius: BorderRadius.circular(12),
        onTap: () => onTap(result),
        child: Padding(
          padding: const EdgeInsets.all(14),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(children: [
                Expanded(child: Text(title, style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 14), maxLines: 1, overflow: TextOverflow.ellipsis)),
                if (score != null)
                  Container(
                    padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                    decoration: BoxDecoration(color: cs.primaryContainer, borderRadius: BorderRadius.circular(8)),
                    child: Text('${(score is num ? (score * 100).toInt() : score)}%', style: TextStyle(fontSize: 10, color: cs.onPrimaryContainer, fontWeight: FontWeight.w600)),
                  ),
              ]),
              if (source.isNotEmpty) ...[
                const SizedBox(height: 4),
                Text(source, style: TextStyle(fontSize: 11, color: cs.onSurface.withOpacity(0.5))),
              ],
              if (content.isNotEmpty) ...[
                const SizedBox(height: 8),
                Text(content, maxLines: 3, overflow: TextOverflow.ellipsis, style: TextStyle(fontSize: 13, color: cs.onSurface.withOpacity(0.7), height: 1.4)),
              ],
            ],
          ),
        ),
      ),
    );
  }
}

// ── Documents tab ─────────────────────────────────────────────────────────────

class _DocumentsTab extends ConsumerStatefulWidget {
  const _DocumentsTab({super.key});

  @override
  ConsumerState<_DocumentsTab> createState() => _DocumentsTabState();
}

class _DocumentsTabState extends ConsumerState<_DocumentsTab> {
  List<Map<String, dynamic>> _docs = [];
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
      final res = await ref.read(dioProvider).get('/api/v1/knowledge/', queryParameters: {'limit': 50, 'offset': 0});
      final data = res.data;
      setState(() {
        _docs = data is Map
            ? List<Map<String, dynamic>>.from((data['items'] ?? data['results'] ?? []) as List)
            : data is List
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

  Future<void> _delete(int id, String title) async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Delete document?'),
        content: Text('Delete "$title" from the knowledge base?'),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Cancel')),
          FilledButton(
            onPressed: () => Navigator.pop(ctx, true),
            style: FilledButton.styleFrom(backgroundColor: Colors.red),
            child: const Text('Delete'),
          ),
        ],
      ),
    );
    if (ok != true) return;
    try {
      await ref.read(dioProvider).delete('/api/v1/knowledge/$id');
      _load();
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('Delete failed: $e'), backgroundColor: Colors.red[700]));
    }
  }

  @override
  Widget build(BuildContext context) {
    final cs = Theme.of(context).colorScheme;
    if (_loading) return const Center(child: CircularProgressIndicator());
    if (_error != null) {
      return Center(child: Column(mainAxisSize: MainAxisSize.min, children: [
        Icon(Icons.error_outline, color: cs.error, size: 40),
        const SizedBox(height: 12),
        Text(_error!, style: TextStyle(color: cs.error), textAlign: TextAlign.center),
        const SizedBox(height: 12),
        FilledButton.icon(onPressed: _load, icon: const Icon(Icons.refresh), label: const Text('Retry')),
      ]));
    }
    if (_docs.isEmpty) {
      return Center(child: Column(mainAxisSize: MainAxisSize.min, children: [
        Icon(Icons.description_outlined, size: 56, color: cs.onSurface.withOpacity(0.2)),
        const SizedBox(height: 12),
        Text('No documents ingested', style: TextStyle(color: cs.onSurface.withOpacity(0.5))),
      ]));
    }
    return RefreshIndicator(
      onRefresh: _load,
      child: ListView.separated(
        padding: const EdgeInsets.all(12),
        itemCount: _docs.length,
        separatorBuilder: (_, __) => const SizedBox(height: 6),
        itemBuilder: (_, i) {
          final doc = _docs[i];
          final id    = doc['id'] as int? ?? 0;
          final title = doc['title']?.toString() ?? 'Untitled';
          final type  = doc['source_type']?.toString() ?? '';
          return Card(
            elevation: 0,
            color: cs.surfaceContainerHighest.withOpacity(0.45),
            shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12), side: BorderSide(color: cs.outline.withOpacity(0.1))),
            child: ListTile(
              contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 4),
              leading: const Icon(Icons.article_outlined, size: 22),
              title: Text(title, style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w500)),
              subtitle: type.isNotEmpty ? Text(type, style: TextStyle(fontSize: 11, color: cs.onSurface.withOpacity(0.5))) : null,
              trailing: IconButton(
                icon: Icon(Icons.delete_outline, size: 18, color: Colors.red[400]),
                onPressed: () => _delete(id, title),
                tooltip: 'Delete',
              ),
            ),
          );
        },
      ),
    );
  }
}
