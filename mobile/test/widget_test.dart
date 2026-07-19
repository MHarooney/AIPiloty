import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:aipiloty_mobile/core/config/app_config.dart';
import 'package:aipiloty_mobile/features/chat/chat_screen.dart';
import 'package:aipiloty_mobile/features/connection/connection_screen.dart';
import 'package:aipiloty_mobile/main.dart';

/// Stub notifier so widget tests never touch secure storage.
class _StubConfigNotifier extends AppConfigNotifier {
  _StubConfigNotifier(this._value);
  final AppConfig? _value;

  @override
  Future<AppConfig?> build() async => _value;
}

void main() {
  testWidgets('App renders MaterialApp without crash', (tester) async {
    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          appConfigProvider.overrideWith(() => _StubConfigNotifier(null)),
        ],
        child: const AIPilotyApp(),
      ),
    );
    await tester.pump();
    expect(find.byType(MaterialApp), findsOneWidget);
  });

  testWidgets('Connection screen smoke when no config', (tester) async {
    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          appConfigProvider.overrideWith(() => _StubConfigNotifier(null)),
        ],
        child: const AIPilotyApp(),
      ),
    );
    await tester.pumpAndSettle();
    expect(find.byType(ConnectionScreen), findsOneWidget);
  });

  testWidgets('Chat screen smoke with mocked config', (tester) async {
    const cfg = AppConfig(
      baseUrl: 'http://localhost:8100',
      apiKey: 'test-key',
    );
    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          appConfigProvider.overrideWith(() => _StubConfigNotifier(cfg)),
        ],
        child: const MaterialApp(home: ChatScreen()),
      ),
    );
    await tester.pump();
    expect(find.byType(ChatScreen), findsOneWidget);
    expect(find.byType(Scaffold), findsWidgets);
  });
}
