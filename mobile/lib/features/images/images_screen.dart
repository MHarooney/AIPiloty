import 'dart:typed_data';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:dio/dio.dart';

import '../../core/network/api_client.dart';

class ImagesScreen extends ConsumerStatefulWidget {
  const ImagesScreen({super.key});

  @override
  ConsumerState<ImagesScreen> createState() => _ImagesScreenState();
}

class _ImagesScreenState extends ConsumerState<ImagesScreen> with SingleTickerProviderStateMixin {
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
        title: const Text('Images'),
        bottom: TabBar(
          controller: _tab,
          tabs: const [
            Tab(text: 'Generate'),
            Tab(text: 'History'),
          ],
        ),
      ),
      body: TabBarView(
        controller: _tab,
        children: [
          _GenerateTab(),
          _HistoryTab(),
        ],
      ),
    );
  }
}

// ── Generate Tab ─────────────────────────────────────────────────────────────

class _GenerateTab extends ConsumerStatefulWidget {
  @override
  ConsumerState<_GenerateTab> createState() => _GenerateTabState();
}

class _GenerateTabState extends ConsumerState<_GenerateTab> {
  final _promptCtrl   = TextEditingController();
  final _negCtrl      = TextEditingController();
  final _formKey      = GlobalKey<FormState>();
  String _size        = '512x512';
  double _steps       = 30;
  bool _generating    = false;
  String? _error;
  String? _resultPath;
  Uint8List? _resultBytes;

  static const _sizes = ['512x512', '768x768', '1024x1024'];

  Future<void> _generate() async {
    if (!_formKey.currentState!.validate()) return;
    setState(() { _generating = true; _error = null; _resultPath = null; _resultBytes = null; });
    try {
      final res = await ref.read(dioProvider).post('/api/v1/images/generate', data: {
        'prompt': _promptCtrl.text.trim(),
        if (_negCtrl.text.trim().isNotEmpty) 'negative_prompt': _negCtrl.text.trim(),
        'size': _size,
        'steps': _steps.round(),
      });
      final path = res.data is Map ? (res.data['file_path'] ?? res.data['path'] ?? res.data['image_path'])?.toString() : null;
      if (path != null) {
        final imgRes = await ref.read(dioProvider).get(
          '/api/v1/files/$path',
          options: Options(responseType: ResponseType.bytes),
        );
        setState(() { _resultBytes = Uint8List.fromList(imgRes.data as List<int>); _resultPath = path; });
      }
      setState(() { _generating = false; });
    } on DioException catch (e) {
      setState(() { _error = e.response?.data?['detail']?.toString() ?? e.message ?? 'Failed'; _generating = false; });
    } catch (e) {
      setState(() { _error = 'Error: $e'; _generating = false; });
    }
  }

  @override
  Widget build(BuildContext context) {
    final cs = Theme.of(context).colorScheme;
    return SingleChildScrollView(
      padding: const EdgeInsets.all(16),
      child: Form(
        key: _formKey,
        child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          TextFormField(
            controller: _promptCtrl,
            decoration: const InputDecoration(labelText: 'Prompt', hintText: 'Describe the image you want...', alignLabelWithHint: true),
            maxLines: 3,
            validator: (v) => v == null || v.trim().isEmpty ? 'Required' : null,
          ),
          const SizedBox(height: 12),
          TextFormField(
            controller: _negCtrl,
            decoration: const InputDecoration(labelText: 'Negative prompt (optional)', hintText: 'What to avoid...'),
            maxLines: 2,
          ),
          const SizedBox(height: 16),
          const Text('Size', style: TextStyle(fontWeight: FontWeight.w600, fontSize: 13)),
          const SizedBox(height: 6),
          Wrap(
            spacing: 8,
            children: _sizes.map((s) => ChoiceChip(
              label: Text(s, style: const TextStyle(fontSize: 12)),
              selected: _size == s,
              onSelected: (_) => setState(() => _size = s),
            )).toList(),
          ),
          const SizedBox(height: 16),
          Row(children: [
            const Text('Steps', style: TextStyle(fontWeight: FontWeight.w600, fontSize: 13)),
            const Spacer(),
            Text('${_steps.round()}', style: TextStyle(color: cs.primary, fontWeight: FontWeight.bold)),
          ]),
          Slider(value: _steps, min: 20, max: 50, divisions: 30, onChanged: (v) => setState(() => _steps = v)),
          const SizedBox(height: 16),
          if (_error != null) ...[
            Container(
              padding: const EdgeInsets.all(10),
              decoration: BoxDecoration(color: cs.errorContainer, borderRadius: BorderRadius.circular(8)),
              child: Text(_error!, style: TextStyle(color: cs.onErrorContainer, fontSize: 12)),
            ),
            const SizedBox(height: 12),
          ],
          FilledButton.icon(
            onPressed: _generating ? null : _generate,
            icon: _generating ? const SizedBox(width: 16, height: 16, child: CircularProgressIndicator(strokeWidth: 2)) : const Icon(Icons.auto_awesome),
            label: Text(_generating ? 'Generating...' : 'Generate'),
          ),
          if (_resultBytes != null) ...[
            const SizedBox(height: 20),
            ClipRRect(
              borderRadius: BorderRadius.circular(12),
              child: Image.memory(_resultBytes!, fit: BoxFit.contain),
            ),
          ],
        ]),
      ),
    );
  }
}

// ── History Tab ───────────────────────────────────────────────────────────────

class _HistoryTab extends ConsumerStatefulWidget {
  @override
  ConsumerState<_HistoryTab> createState() => _HistoryTabState();
}

class _HistoryTabState extends ConsumerState<_HistoryTab> {
  List<Map<String, dynamic>> _images = [];
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
      final res = await ref.read(dioProvider).get('/api/v1/images/history', queryParameters: {'page': 1, 'per_page': 20});
      final data = res.data;
      List raw = data is List ? data : (data is Map ? (data['items'] ?? data['images'] ?? []) as List : []);
      setState(() {
        _images = raw.map((e) => Map<String, dynamic>.from(e as Map)).toList();
        _loading = false;
      });
    } on DioException catch (e) {
      setState(() { _error = e.response?.data?['detail']?.toString() ?? e.message ?? 'Failed'; _loading = false; });
    } catch (e) {
      setState(() { _error = 'Error: $e'; _loading = false; });
    }
  }

  Future<void> _delete(dynamic imageId, String? prompt) async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Delete image?'),
        content: Text(prompt != null ? '"$prompt"' : 'Delete this image?'),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Cancel')),
          FilledButton(onPressed: () => Navigator.pop(ctx, true), style: FilledButton.styleFrom(backgroundColor: Colors.red), child: const Text('Delete')),
        ],
      ),
    );
    if (ok != true) return;
    try {
      await ref.read(dioProvider).delete('/api/v1/images/$imageId');
      _load();
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('Delete failed: $e'), backgroundColor: Colors.red[700]));
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
        Text(_error!, style: TextStyle(color: cs.error), textAlign: TextAlign.center),
        const SizedBox(height: 12),
        FilledButton.icon(onPressed: _load, icon: const Icon(Icons.refresh), label: const Text('Retry')),
      ]));
    }
    if (_images.isEmpty) {
      return Center(child: Column(mainAxisSize: MainAxisSize.min, children: [
        Icon(Icons.image_outlined, size: 56, color: cs.onSurface.withOpacity(0.2)),
        const SizedBox(height: 12),
        Text('No generated images yet', style: TextStyle(color: cs.onSurface.withOpacity(0.5))),
      ]));
    }
    return RefreshIndicator(
      onRefresh: _load,
      child: GridView.builder(
        padding: const EdgeInsets.all(8),
        gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(crossAxisCount: 2, mainAxisSpacing: 8, crossAxisSpacing: 8),
        itemCount: _images.length,
        itemBuilder: (_, i) {
          final img    = _images[i];
          final id     = img['id'] ?? img['image_id'];
          final prompt = img['prompt']?.toString();
          final path   = img['file_path']?.toString() ?? img['path']?.toString();
          return _ImageCard(imageId: id, prompt: prompt, filePath: path, onDelete: () => _delete(id, prompt));
        },
      ),
    );
  }
}

class _ImageCard extends ConsumerStatefulWidget {
  final dynamic imageId;
  final String? prompt;
  final String? filePath;
  final VoidCallback onDelete;

  const _ImageCard({required this.imageId, this.prompt, this.filePath, required this.onDelete});

  @override
  ConsumerState<_ImageCard> createState() => _ImageCardState();
}

class _ImageCardState extends ConsumerState<_ImageCard> {
  Uint8List? _bytes;
  bool _loading = true;

  @override
  void initState() {
    super.initState();
    _fetchImage();
  }

  Future<void> _fetchImage() async {
    if (widget.filePath == null) { setState(() => _loading = false); return; }
    try {
      final res = await ref.read(dioProvider).get(
        '/api/v1/files/${widget.filePath}',
        options: Options(responseType: ResponseType.bytes),
      );
      if (mounted) setState(() { _bytes = Uint8List.fromList(res.data as List<int>); _loading = false; });
    } catch (_) {
      if (mounted) setState(() => _loading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final cs = Theme.of(context).colorScheme;
    return Card(
      elevation: 0,
      clipBehavior: Clip.antiAlias,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
      child: Stack(fit: StackFit.expand, children: [
        _loading
            ? const Center(child: CircularProgressIndicator())
            : _bytes != null
                ? Image.memory(_bytes!, fit: BoxFit.cover)
                : Container(color: cs.surfaceContainerHighest, child: Icon(Icons.broken_image_outlined, color: cs.onSurface.withOpacity(0.3))),
        Positioned(
          bottom: 0, left: 0, right: 0,
          child: Container(
            padding: const EdgeInsets.fromLTRB(8, 20, 4, 4),
            decoration: const BoxDecoration(gradient: LinearGradient(begin: Alignment.topCenter, end: Alignment.bottomCenter, colors: [Colors.transparent, Colors.black54])),
            child: Row(children: [
              if (widget.prompt != null) Expanded(child: Text(widget.prompt!, maxLines: 2, overflow: TextOverflow.ellipsis, style: const TextStyle(color: Colors.white, fontSize: 10))),
              IconButton(icon: const Icon(Icons.delete, size: 16, color: Colors.white70), onPressed: widget.onDelete, padding: EdgeInsets.zero, constraints: const BoxConstraints()),
            ]),
          ),
        ),
      ]),
    );
  }
}
