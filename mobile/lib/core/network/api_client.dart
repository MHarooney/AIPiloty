import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../config/app_config.dart';

/// Provides a configured [Dio] instance based on the saved config.
final dioProvider = Provider<Dio>((ref) {
  final config = ref.watch(appConfigProvider).valueOrNull;
  final dio = Dio(BaseOptions(
    baseUrl: config?.baseUrl ?? 'http://localhost:8100',
    connectTimeout: const Duration(seconds: 30),
    receiveTimeout: const Duration(seconds: 60),
    sendTimeout: const Duration(seconds: 30),
    headers: {
      'Content-Type': 'application/json',
      if (config?.apiKey != null && config!.apiKey.isNotEmpty)
        'X-API-Key': config.apiKey,
    },
  ));
  return dio;
});
