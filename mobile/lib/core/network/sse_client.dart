import 'dart:async';
import 'dart:convert';
import 'package:http/http.dart' as http;

/// Parsed SSE event from the backend.
class SseEvent {
  final String type;
  final Map<String, dynamic> data;
  const SseEvent({required this.type, required this.data});
}

/// SSE client that connects via POST (to send messages + API key header).
class SseClient {
  SseClient._();

  /// Connect to the chat stream endpoint and yield [SseEvent]s.
  static Stream<SseEvent> connect({
    required String url,
    required Map<String, String> headers,
    required String body,
  }) async* {
    final request = http.Request('POST', Uri.parse(url))
      ..headers.addAll(headers)
      ..body = body;

    final client = http.Client();
    try {
      final response = await client.send(request);
      if (response.statusCode != 200) {
        yield SseEvent(
          type: 'error',
          data: {'message': 'HTTP ${response.statusCode}'},
        );
        return;
      }

      String buffer = '';
      await for (final chunk in response.stream.transform(utf8.decoder)) {
        buffer += chunk;
        final lines = buffer.split('\n');
        buffer = lines.removeLast(); // keep incomplete line

        for (final line in lines) {
          if (line.startsWith('data: ')) {
            final raw = line.substring(6).trim();
            if (raw == '[DONE]') {
              yield const SseEvent(type: 'done', data: {});
              return;
            }
            try {
              final parsed = jsonDecode(raw) as Map<String, dynamic>;
              yield SseEvent(
                type: parsed['type'] as String? ?? 'unknown',
                data: parsed,
              );
            } catch (_) {
              // skip malformed JSON
            }
          }
        }
      }
    } finally {
      client.close();
    }
  }
}
