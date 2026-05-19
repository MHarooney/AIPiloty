import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';

const _keyBaseUrl = 'aipiloty_base_url';
const _keyApiKey = 'aipiloty_api_key';

class AppConfig {
  final String baseUrl;
  final String apiKey;

  const AppConfig({required this.baseUrl, required this.apiKey});
}

final _storage = FlutterSecureStorage(
  aOptions: const AndroidOptions(encryptedSharedPreferences: true),
  iOptions: const IOSOptions(
    accessibility: KeychainAccessibility.first_unlock_this_device,
  ),
);

/// Provides the stored config. Returns null when not yet set up.
final appConfigProvider =
    AsyncNotifierProvider<AppConfigNotifier, AppConfig?>(AppConfigNotifier.new);

class AppConfigNotifier extends AsyncNotifier<AppConfig?> {
  @override
  Future<AppConfig?> build() async {
    final url = await _storage.read(key: _keyBaseUrl);
    final key = await _storage.read(key: _keyApiKey);
    if (url == null || url.isEmpty) return null;
    return AppConfig(baseUrl: url, apiKey: key ?? '');
  }

  Future<void> save(String baseUrl, String apiKey) async {
    await _storage.write(key: _keyBaseUrl, value: baseUrl);
    await _storage.write(key: _keyApiKey, value: apiKey);
    state = AsyncData(AppConfig(baseUrl: baseUrl, apiKey: apiKey));
  }

  Future<void> clear() async {
    await _storage.delete(key: _keyBaseUrl);
    await _storage.delete(key: _keyApiKey);
    state = const AsyncData(null);
  }
}
