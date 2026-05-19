import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/network/api_client.dart';

/// Simple code viewer — browse workspace files and view with syntax-style display.
class CodeViewerScreen extends ConsumerStatefulWidget {
  const CodeViewerScreen({super.key});

  @override
  ConsumerState<CodeViewerScreen> createState() => _CodeViewerScreenState();
}

class _CodeViewerScreenState extends ConsumerState<CodeViewerScreen> {
  List<dynamic> _files = [];
  String? _currentPath;
  String? _fileContent;
  bool _loading = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    _loadDirectory('.');
  }

  Future<void> _loadDirectory(String path) async {
    setState(() {
      _loading = true;
      _error = null;
      _fileContent = null;
    });

    try {
      final dio = ref.read(dioProvider);
      final resp = await dio.get('/api/v1/workspace/tree', queryParameters: {
        'path': path,
        'depth': 1,
      });
      setState(() {
        _files = resp.data['children'] ?? resp.data['entries'] ?? [];
        _currentPath = path;
      });
    } on DioException catch (e) {
      setState(() => _error = e.message ?? 'Failed to load directory');
    } finally {
      setState(() => _loading = false);
    }
  }

  Future<void> _loadFile(String path) async {
    setState(() {
      _loading = true;
      _error = null;
    });

    try {
      final dio = ref.read(dioProvider);
      final resp = await dio.get('/api/v1/workspace/file', queryParameters: {
        'path': path,
      });
      setState(() {
        _fileContent = resp.data['content'] ?? resp.data.toString();
        _currentPath = path;
      });
    } on DioException catch (e) {
      setState(() => _error = e.message ?? 'Failed to load file');
    } finally {
      setState(() => _loading = false);
    }
  }

  void _handleTap(dynamic entry) {
    final name = entry['name'] as String? ?? '';
    final path = entry['path'] as String? ?? name;
    final isDir = entry['is_dir'] == true ||
        entry['type'] == 'directory' ||
        (name.endsWith('/'));

    if (isDir) {
      _loadDirectory(path);
    } else {
      _loadFile(path);
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return Scaffold(
      appBar: AppBar(
        title: Text(_currentPath ?? 'Code Viewer'),
        leading: _fileContent != null || (_currentPath != null && _currentPath != '.')
            ? IconButton(
                icon: const Icon(Icons.arrow_back),
                onPressed: () {
                  if (_fileContent != null) {
                    // Go back to directory listing
                    final dir = _currentPath!.contains('/')
                        ? _currentPath!.substring(0, _currentPath!.lastIndexOf('/'))
                        : '.';
                    _loadDirectory(dir);
                  } else if (_currentPath != null && _currentPath != '.') {
                    final parent = _currentPath!.contains('/')
                        ? _currentPath!.substring(0, _currentPath!.lastIndexOf('/'))
                        : '.';
                    _loadDirectory(parent);
                  }
                },
              )
            : null,
        actions: [
          if (_fileContent != null)
            IconButton(
              icon: const Icon(Icons.copy),
              tooltip: 'Copy content',
              onPressed: () {
                Clipboard.setData(ClipboardData(text: _fileContent!));
                ScaffoldMessenger.of(context).showSnackBar(
                  const SnackBar(content: Text('Copied to clipboard')),
                );
              },
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
                        onPressed: () => _loadDirectory('.'),
                        child: const Text('Retry'),
                      ),
                    ],
                  ),
                )
              : _fileContent != null
                  ? _buildFileViewer(theme)
                  : _buildFileList(theme),
    );
  }

  Widget _buildFileList(ThemeData theme) {
    if (_files.isEmpty) {
      return const Center(child: Text('Empty directory'));
    }

    return ListView.builder(
      itemCount: _files.length,
      itemBuilder: (context, index) {
        final entry = _files[index];
        final name = entry['name'] as String? ?? 'unknown';
        final isDir = entry['is_dir'] == true || entry['type'] == 'directory' || name.endsWith('/');

        return ListTile(
          leading: Icon(
            isDir ? Icons.folder : _fileIcon(name),
            color: isDir ? Colors.amber : theme.colorScheme.primary,
          ),
          title: Text(name),
          subtitle: entry['size'] != null
              ? Text(_formatSize(entry['size'] as int))
              : null,
          trailing: isDir ? const Icon(Icons.chevron_right) : null,
          onTap: () => _handleTap(entry),
        );
      },
    );
  }

  Widget _buildFileViewer(ThemeData theme) {
    return SingleChildScrollView(
      padding: const EdgeInsets.all(12),
      child: Container(
        width: double.infinity,
        padding: const EdgeInsets.all(16),
        decoration: BoxDecoration(
          color: const Color(0xFF1E1E2E),
          borderRadius: BorderRadius.circular(12),
        ),
        child: SelectableText(
          _fileContent!,
          style: const TextStyle(
            fontFamily: 'JetBrains Mono',
            fontFamilyFallback: ['monospace', 'Courier'],
            fontSize: 13,
            height: 1.5,
            color: Color(0xFFCDD6F4),
          ),
        ),
      ),
    );
  }

  IconData _fileIcon(String name) {
    if (name.endsWith('.dart') || name.endsWith('.py') || name.endsWith('.ts') || name.endsWith('.js')) {
      return Icons.code;
    }
    if (name.endsWith('.json') || name.endsWith('.yaml') || name.endsWith('.yml')) {
      return Icons.data_object;
    }
    if (name.endsWith('.md')) return Icons.description;
    if (name.endsWith('.png') || name.endsWith('.jpg') || name.endsWith('.svg')) return Icons.image;
    return Icons.insert_drive_file;
  }

  String _formatSize(int bytes) {
    if (bytes < 1024) return '$bytes B';
    if (bytes < 1024 * 1024) return '${(bytes / 1024).toStringAsFixed(1)} KB';
    return '${(bytes / (1024 * 1024)).toStringAsFixed(1)} MB';
  }
}
