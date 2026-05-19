import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:dio/dio.dart';

import '../../core/config/app_config.dart';

class ConnectionScreen extends ConsumerStatefulWidget {
  const ConnectionScreen({super.key});

  @override
  ConsumerState<ConnectionScreen> createState() => _ConnectionScreenState();
}

class _ConnectionScreenState extends ConsumerState<ConnectionScreen> {
  final _urlCtrl = TextEditingController(text: 'http://');
  final _keyCtrl = TextEditingController();
  bool _testing = false;
  String? _status;
  bool _ok = false;

  @override
  void dispose() {
    _urlCtrl.dispose();
    _keyCtrl.dispose();
    super.dispose();
  }

  Future<void> _testConnection() async {
    setState(() {
      _testing = true;
      _status = null;
    });

    final url = _urlCtrl.text.trim();
    final key = _keyCtrl.text.trim();

    if (url.isEmpty) {
      setState(() {
        _testing = false;
        _status = 'URL is required';
      });
      return;
    }

    try {
      final dio = Dio(BaseOptions(
        connectTimeout: const Duration(seconds: 5),
        receiveTimeout: const Duration(seconds: 5),
      ));

      if (key.isNotEmpty) {
        dio.options.headers['X-API-Key'] = key;
      }

      final resp = await dio.get('$url/api/v1/health');
      if (resp.statusCode == 200) {
        setState(() {
          _ok = true;
          _status = 'Connected! ${resp.data}';
        });
      } else {
        setState(() {
          _ok = false;
          _status = 'HTTP ${resp.statusCode}';
        });
      }
    } on DioException catch (e) {
      setState(() {
        _ok = false;
        _status = e.message ?? 'Connection failed';
      });
    } catch (e) {
      setState(() {
        _ok = false;
        _status = e.toString();
      });
    } finally {
      setState(() => _testing = false);
    }
  }

  Future<void> _save() async {
    final url = _urlCtrl.text.trim();
    final key = _keyCtrl.text.trim();
    await ref.read(appConfigProvider.notifier).save(url, key);
  }

  @override
  Widget build(BuildContext context) {
    final cs = Theme.of(context).colorScheme;

    return Scaffold(
      body: SafeArea(
        child: Center(
          child: SingleChildScrollView(
            padding: const EdgeInsets.symmetric(horizontal: 32),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                Icon(Icons.rocket_launch, size: 64, color: cs.primary),
                const SizedBox(height: 16),
                Text(
                  'AIPiloty',
                  style: Theme.of(context).textTheme.headlineMedium?.copyWith(
                        fontWeight: FontWeight.bold,
                      ),
                ),
                const SizedBox(height: 8),
                Text(
                  'Connect to your desktop agent',
                  style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                        color: cs.onSurface.withValues(alpha: 0.7),
                      ),
                ),
                const SizedBox(height: 40),
                TextField(
                  controller: _urlCtrl,
                  decoration: const InputDecoration(
                    labelText: 'Backend URL',
                    hintText: 'http://192.168.1.x:8000',
                    prefixIcon: Icon(Icons.link),
                  ),
                  keyboardType: TextInputType.url,
                  autocorrect: false,
                ),
                const SizedBox(height: 16),
                TextField(
                  controller: _keyCtrl,
                  decoration: const InputDecoration(
                    labelText: 'API Key (optional)',
                    prefixIcon: Icon(Icons.key),
                  ),
                  obscureText: true,
                  autocorrect: false,
                ),
                const SizedBox(height: 24),
                SizedBox(
                  width: double.infinity,
                  child: FilledButton.icon(
                    onPressed: _testing ? null : _testConnection,
                    icon: _testing
                        ? const SizedBox(
                            width: 18,
                            height: 18,
                            child: CircularProgressIndicator(strokeWidth: 2),
                          )
                        : const Icon(Icons.wifi_find),
                    label: const Text('Test Connection'),
                  ),
                ),
                if (_status != null) ...[
                  const SizedBox(height: 16),
                  Container(
                    padding: const EdgeInsets.all(12),
                    decoration: BoxDecoration(
                      color: (_ok ? Colors.green : Colors.red)
                          .withValues(alpha: 0.15),
                      borderRadius: BorderRadius.circular(8),
                    ),
                    child: Row(
                      children: [
                        Icon(
                          _ok ? Icons.check_circle : Icons.error,
                          color: _ok ? Colors.green : Colors.red,
                          size: 20,
                        ),
                        const SizedBox(width: 8),
                        Expanded(
                          child: Text(
                            _status!,
                            style: TextStyle(
                              color: _ok ? Colors.green : Colors.red,
                            ),
                          ),
                        ),
                      ],
                    ),
                  ),
                ],
                if (_ok) ...[
                  const SizedBox(height: 16),
                  SizedBox(
                    width: double.infinity,
                    child: FilledButton.icon(
                      onPressed: _save,
                      icon: const Icon(Icons.save),
                      label: const Text('Save & Continue'),
                    ),
                  ),
                ],
              ],
            ),
          ),
        ),
      ),
    );
  }
}
