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
              (data['results'] as List).map((e) => Map<String, dynamic>.from(e)))
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

    return Column(
      children: [
        // Search bar
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
                      controller: _controller,
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
                        contentPadding: const EdgeInsets.symmetric(
                            horizontal: 12, vertical: 10),
                      ),
                      textInputAction: TextInputAction.search,
                      onSubmitted: (_) => _search(),
                    ),
                  ),
                  const SizedBox(width: 8),
                  FilledButton.tonal(
                    onPressed: _loading ? null : _search,
                    child: _loading
                        ? const SizedBox(
                            width: 18,
                            height: 18,
                            child:
                                CircularProgressIndicator(strokeWidth: 2))
                        : const Text('Search'),
                  ),
                ],
              ),
              const SizedBox(height: 8),
              // Mode selector
              Row(
                children: [
                  _modeChip('hybrid', 'Hybrid', cs),
                  const SizedBox(width: 6),
                  _modeChip('semantic', 'Semantic', cs),
                  const SizedBox(width: 6),
                  _modeChip('keyword', 'Keyword', cs),
                ],
              ),
            ],
          ),
        ),

        // Results
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
                                onPressed: _search,
                                child: const Text('Retry')),
                          ],
                        ),
                      ),
                    )
                  : !_hasSearched
                      ? Center(
                          child: Column(
                            mainAxisSize: MainAxisSize.min,
                            children: [
                              Icon(Icons.library_books_outlined,
                                  size: 56,
                                  color: cs.onSurface.withOpacity(0.2)),
                              const SizedBox(height: 12),
                              Text('Search your knowledge base',
                                  style: TextStyle(
                                      color: cs.onSurface.withOpacity(0.5))),
                              const SizedBox(height: 4),
                              Text(
                                  'Find documents, code, and notes',
                                  style: TextStyle(
                                      fontSize: 12,
                                      color:
                                          cs.onSurface.withOpacity(0.3))),
                            ],
                          ),
                        )
                      : _results.isEmpty
                          ? Center(
                              child: Text('No results found',
                                  style: TextStyle(
                                      color: cs.onSurface.withOpacity(0.5))))
                          : ListView.separated(
                              padding: const EdgeInsets.all(12),
                              itemCount: _results.length,
                              separatorBuilder: (_, __) =>
                                  const SizedBox(height: 8),
                              itemBuilder: (context, i) =>
                                  _resultCard(_results[i], cs),
                            ),
        ),
      ],
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
