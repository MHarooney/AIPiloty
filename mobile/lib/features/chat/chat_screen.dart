import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_markdown/flutter_markdown.dart';
import 'package:dio/dio.dart';

import '../../core/config/app_config.dart';
import '../../core/network/api_client.dart';
import '../../core/network/sse_client.dart';
import '../../core/providers/session_provider.dart';

/// Status of a single tool execution.
enum ToolStatus { running, success, error }

/// Tracks one tool call during agent execution.
class _ToolExec {
  final String name;
  ToolStatus status;
  _ToolExec({required this.name, this.status = ToolStatus.running});
}

/// Simple chat message model.
class _Msg {
  final String role; // 'user' | 'assistant'
  String text;
  bool streaming;
  final List<_ToolExec> toolCalls;

  _Msg({
    required this.role,
    required this.text,
    this.streaming = false,
    List<_ToolExec>? toolCalls,
  }) : toolCalls = toolCalls ?? [];
}

class ChatScreen extends ConsumerStatefulWidget {
  const ChatScreen({super.key});

  @override
  ConsumerState<ChatScreen> createState() => _ChatScreenState();
}

class _ChatScreenState extends ConsumerState<ChatScreen> {
  final _inputCtrl = TextEditingController();
  final _scrollCtrl = ScrollController();
  final List<_Msg> _messages = [];
  bool _busy = false;
  String? _sessionKey;
  String? _toolStatus;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      final key = ref.read(activeSessionKeyProvider);
      if (key != null && key.isNotEmpty) {
        setState(() => _sessionKey = key);
        ref.read(activeSessionKeyProvider.notifier).state = null;
      }
    });
  }

  @override
  void dispose() {
    _inputCtrl.dispose();
    _scrollCtrl.dispose();
    super.dispose();
  }

  void _scrollToBottom() {
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (_scrollCtrl.hasClients) {
        _scrollCtrl.animateTo(
          _scrollCtrl.position.maxScrollExtent,
          duration: const Duration(milliseconds: 200),
          curve: Curves.easeOut,
        );
      }
    });
  }

  Future<void> _send() async {
    final text = _inputCtrl.text.trim();
    if (text.isEmpty || _busy) return;

    _inputCtrl.clear();
    setState(() {
      _messages.add(_Msg(role: 'user', text: text));
      _messages.add(_Msg(role: 'assistant', text: '', streaming: true));
      _busy = true;
      _toolStatus = null;
    });
    _scrollToBottom();

    final config = ref.read(appConfigProvider).valueOrNull;
    if (config == null) return;

    final body = <String, dynamic>{
      'message': text,
      'stream': true,
    };
    if (_sessionKey != null) {
      body['session_key'] = _sessionKey;
    }

    final headers = <String, String>{
      'Content-Type': 'application/json',
      if (config.apiKey.isNotEmpty) 'X-API-Key': config.apiKey,
    };

    try {
      final stream = SseClient.connect(
        url: '${config.baseUrl}/api/v1/chat',
        headers: headers,
        body: jsonEncode(body),
      );

      await for (final event in stream) {
        final assistantMsg = _messages.last;

        switch (event.type) {
          case 'token':
            assistantMsg.text += (event.data['content'] ?? event.data['token'] ?? '').toString();
            break;
          case 'planning':
            setState(() => _toolStatus = '🧠 Planning...');
            break;
          case 'tool_start':
            final toolName = (event.data['tool'] ?? 'tool').toString();
            assistantMsg.toolCalls.add(_ToolExec(name: toolName));
            setState(() => _toolStatus = '🔧 Running $toolName...');
            break;
          case 'tool_output':
            final toolName = (event.data['tool'] ?? '').toString();
            final output = (event.data['output'] ?? '').toString();
            bool success = true;
            try {
              final parsed = jsonDecode(output);
              if (parsed is Map && parsed['success'] == false) success = false;
            } catch (_) {}
            // Mark matching tool call as done
            for (final tc in assistantMsg.toolCalls.reversed) {
              if (tc.name == toolName && tc.status == ToolStatus.running) {
                tc.status = success ? ToolStatus.success : ToolStatus.error;
                break;
              }
            }
            setState(() => _toolStatus = null);
            break;
          case 'final_report':
            assistantMsg.text = (event.data['content'] ?? event.data['report'] ?? '').toString();
            assistantMsg.streaming = false;
            setState(() => _toolStatus = null);
            break;
          case 'session_key':
            _sessionKey = (event.data['key'] ?? event.data['session_key'] ?? '').toString();
            break;
          case 'done':
            assistantMsg.streaming = false;
            setState(() {
              _toolStatus = null;
              _busy = false;
            });
            break;
          case 'error':
            assistantMsg.text += '\n\n**Error:** ${event.data['message'] ?? event.data}';
            assistantMsg.streaming = false;
            setState(() {
              _toolStatus = null;
              _busy = false;
            });
            break;
          default:
            break;
        }
        setState(() {});
        _scrollToBottom();
      }
    } catch (e) {
      if (_messages.isNotEmpty && _messages.last.role == 'assistant') {
        _messages.last.text += '\n\n**Connection error:** $e';
        _messages.last.streaming = false;
      }
      setState(() {
        _busy = false;
        _toolStatus = null;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final cs = Theme.of(context).colorScheme;

    return Scaffold(
      appBar: AppBar(
        title: const Text('Chat'),
        actions: [
          if (_sessionKey != null)
            IconButton(
              icon: const Icon(Icons.add_comment),
              tooltip: 'New session',
              onPressed: () => setState(() {
                _sessionKey = null;
                _messages.clear();
              }),
            ),
          IconButton(
            icon: const Icon(Icons.settings),
            tooltip: 'Connection settings',
            onPressed: () async {
              await ref.read(appConfigProvider.notifier).clear();
            },
          ),
        ],
      ),
      body: Column(
        children: [
          // Tool status bar
          if (_toolStatus != null)
            Container(
              width: double.infinity,
              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
              color: cs.primaryContainer,
              child: Text(
                _toolStatus!,
                style: TextStyle(color: cs.onPrimaryContainer, fontSize: 13),
              ),
            ),

          // Messages
          Expanded(
            child: _messages.isEmpty
                ? Center(
                    child: Column(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Icon(Icons.chat_bubble_outline,
                            size: 48,
                            color: cs.onSurface.withValues(alpha: 0.3)),
                        const SizedBox(height: 8),
                        Text(
                          'Say hello to your agent',
                          style: TextStyle(
                              color: cs.onSurface.withValues(alpha: 0.5)),
                        ),
                      ],
                    ),
                  )
                : ListView.builder(
                    controller: _scrollCtrl,
                    padding: const EdgeInsets.symmetric(
                        horizontal: 12, vertical: 8),
                    itemCount: _messages.length,
                    itemBuilder: (_, i) => _buildBubble(_messages[i]),
                  ),
          ),

          // Input
          Container(
            padding: const EdgeInsets.fromLTRB(12, 8, 8, 12),
            decoration: BoxDecoration(
              color: cs.surfaceContainerHighest,
              border: Border(
                  top: BorderSide(
                      color: cs.outlineVariant.withValues(alpha: 0.3))),
            ),
            child: SafeArea(
              top: false,
              child: Row(
                children: [
                  Expanded(
                    child: TextField(
                      controller: _inputCtrl,
                      minLines: 1,
                      maxLines: 4,
                      textInputAction: TextInputAction.send,
                      onSubmitted: (_) => _send(),
                      decoration: InputDecoration(
                        hintText: 'Message your agent...',
                        border: OutlineInputBorder(
                          borderRadius: BorderRadius.circular(24),
                        ),
                        contentPadding: const EdgeInsets.symmetric(
                            horizontal: 16, vertical: 10),
                        isDense: true,
                      ),
                    ),
                  ),
                  const SizedBox(width: 8),
                  IconButton.filled(
                    onPressed: _busy ? null : _send,
                    icon: _busy
                        ? const SizedBox(
                            width: 20,
                            height: 20,
                            child: CircularProgressIndicator(strokeWidth: 2),
                          )
                        : const Icon(Icons.send),
                  ),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildBubble(_Msg msg) {
    final isUser = msg.role == 'user';
    final cs = Theme.of(context).colorScheme;

    return Align(
      alignment: isUser ? Alignment.centerRight : Alignment.centerLeft,
      child: Container(
        constraints:
            BoxConstraints(maxWidth: MediaQuery.of(context).size.width * 0.85),
        margin: const EdgeInsets.symmetric(vertical: 4),
        padding: const EdgeInsets.all(12),
        decoration: BoxDecoration(
          color: isUser ? cs.primary : cs.surfaceContainerHighest,
          borderRadius: BorderRadius.only(
            topLeft: const Radius.circular(16),
            topRight: const Radius.circular(16),
            bottomLeft: Radius.circular(isUser ? 16 : 4),
            bottomRight: Radius.circular(isUser ? 4 : 16),
          ),
        ),
        child: isUser
            ? Text(msg.text,
                style: TextStyle(color: cs.onPrimary))
            : Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                mainAxisSize: MainAxisSize.min,
                children: [
                  // Tool execution chips
                  if (msg.toolCalls.isNotEmpty) ...[
                    Wrap(
                      spacing: 6,
                      runSpacing: 4,
                      children: msg.toolCalls.map((tc) {
                        final IconData icon;
                        final Color color;
                        switch (tc.status) {
                          case ToolStatus.running:
                            icon = Icons.hourglass_top;
                            color = cs.primary;
                          case ToolStatus.success:
                            icon = Icons.check_circle;
                            color = Colors.green;
                          case ToolStatus.error:
                            icon = Icons.error;
                            color = Colors.redAccent;
                        }
                        return Chip(
                          avatar: tc.status == ToolStatus.running
                              ? SizedBox(
                                  width: 14,
                                  height: 14,
                                  child: CircularProgressIndicator(
                                    strokeWidth: 1.5,
                                    color: color,
                                  ),
                                )
                              : Icon(icon, size: 14, color: color),
                          label: Text(
                            tc.name,
                            style: TextStyle(fontSize: 11, color: cs.onSurface),
                          ),
                          backgroundColor:
                              cs.surfaceContainerHighest,
                          side: BorderSide(
                            color: color.withValues(alpha: 0.4),
                          ),
                          materialTapTargetSize:
                              MaterialTapTargetSize.shrinkWrap,
                          visualDensity: VisualDensity.compact,
                          padding: EdgeInsets.zero,
                        );
                      }).toList(),
                    ),
                    const SizedBox(height: 8),
                  ],
                  if (msg.text.isNotEmpty)
                    MarkdownBody(
                      data: msg.text,
                      selectable: true,
                      onTapLink: (text, href, title) {
                        if (href != null) _handleLinkTap(href);
                      },
                      styleSheet: MarkdownStyleSheet.fromTheme(
                              Theme.of(context))
                          .copyWith(
                        p: TextStyle(color: cs.onSurface, fontSize: 14),
                        code: TextStyle(
                          color: cs.onSurface,
                          backgroundColor:
                              cs.surfaceContainerHighest,
                          fontSize: 13,
                        ),
                      ),
                    ),
                  // Detect inline file links (not handled by markdown)
                  ..._extractFileLinks(msg.text).map((link) => Padding(
                        padding: const EdgeInsets.only(top: 6),
                        child: InkWell(
                          onTap: () => _downloadFile(link),
                          borderRadius: BorderRadius.circular(8),
                          child: Container(
                            padding: const EdgeInsets.symmetric(
                                horizontal: 10, vertical: 6),
                            decoration: BoxDecoration(
                              color: cs.primaryContainer,
                              borderRadius: BorderRadius.circular(8),
                            ),
                            child: Row(
                              mainAxisSize: MainAxisSize.min,
                              children: [
                                Icon(Icons.file_download,
                                    size: 16, color: cs.onPrimaryContainer),
                                const SizedBox(width: 6),
                                Flexible(
                                  child: Text(
                                    link.split('/').last,
                                    style: TextStyle(
                                      color: cs.onPrimaryContainer,
                                      fontSize: 12,
                                      fontWeight: FontWeight.w500,
                                    ),
                                    overflow: TextOverflow.ellipsis,
                                  ),
                                ),
                              ],
                            ),
                          ),
                        ),
                      )),
                  if (msg.streaming && msg.text.isEmpty)
                    SizedBox(
                      width: 24,
                      height: 24,
                      child: CircularProgressIndicator(
                        strokeWidth: 2,
                        color: cs.primary,
                      ),
                    ),
                ],
              ),
      ),
    );
  }

  /// Extract file download paths from message text.
  static final _filePathRegex = RegExp(
    r'/api/v1/files/generated/[^\s\)\]"]+',
  );

  List<String> _extractFileLinks(String text) {
    return _filePathRegex
        .allMatches(text)
        .map((m) => m.group(0)!)
        .toSet()
        .toList();
  }

  /// Handle taps on markdown links — download if it's a generated file.
  void _handleLinkTap(String href) {
    if (href.contains('/api/v1/files/generated/') ||
        href.contains('/files/generated/')) {
      _downloadFile(href);
    }
  }

  /// Download a generated file via Dio and show a snackbar.
  Future<void> _downloadFile(String path) async {
    final config = ref.read(appConfigProvider).valueOrNull;
    if (config == null) return;

    final url = path.startsWith('http')
        ? path
        : '${config.baseUrl}$path';

    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text('Downloading ${path.split('/').last}...'),
        duration: const Duration(seconds: 2),
      ),
    );

    try {
      final dio = ref.read(dioProvider);
      final response = await dio.get<List<int>>(
        url,
        options: Options(responseType: ResponseType.bytes),
      );
      // Show success — on mobile, full file-save requires path_provider
      // which isn't in deps yet, so just confirm download for now.
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(
              '${path.split('/').last} downloaded (${(response.data?.length ?? 0) ~/ 1024} KB)',
            ),
          ),
        );
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Download failed: $e')),
        );
      }
    }
  }
}
