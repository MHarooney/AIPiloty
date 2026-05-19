import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

/// Biometric / PIN authentication screen.
///
/// Uses [LocalAuthentication] from the `local_auth` package.
/// Falls back gracefully if biometric hardware is unavailable.

// Provider that checks biometric availability
final biometricAvailableProvider = FutureProvider<bool>((ref) async {
  try {
    final localAuth = await _getLocalAuth();
    return localAuth != null;
  } catch (_) {
    return false;
  }
});

/// Try to import local_auth at runtime — returns null if not available.
Future<dynamic> _getLocalAuth() async {
  try {
    // Attempt platform channel check for biometric capability
    const channel = MethodChannel('plugins.flutter.io/local_auth');
    final available = await channel.invokeMethod<bool>('isDeviceSupported');
    return available == true ? true : null;
  } catch (_) {
    return null;
  }
}

class BiometricScreen extends ConsumerStatefulWidget {
  final VoidCallback onAuthenticated;

  const BiometricScreen({super.key, required this.onAuthenticated});

  @override
  ConsumerState<BiometricScreen> createState() => _BiometricScreenState();
}

class _BiometricScreenState extends ConsumerState<BiometricScreen> {
  bool _authenticating = false;
  String? _error;

  Future<void> _authenticate() async {
    setState(() {
      _authenticating = true;
      _error = null;
    });

    try {
      const channel = MethodChannel('plugins.flutter.io/local_auth');
      final result = await channel.invokeMethod<bool>('authenticate', {
        'localizedReason': 'Authenticate to access AIPiloty',
        'useErrorDialogs': true,
        'stickyAuth': true,
        'biometricOnly': false,
      });

      if (result == true) {
        widget.onAuthenticated();
      } else {
        setState(() => _error = 'Authentication failed');
      }
    } on PlatformException catch (e) {
      setState(() => _error = e.message ?? 'Biometric error');
    } catch (e) {
      setState(() => _error = 'Biometric not available');
    } finally {
      setState(() => _authenticating = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return Scaffold(
      body: Center(
        child: Padding(
          padding: const EdgeInsets.all(32),
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              Container(
                width: 100,
                height: 100,
                decoration: BoxDecoration(
                  color: theme.colorScheme.primaryContainer,
                  shape: BoxShape.circle,
                ),
                child: Icon(
                  Icons.fingerprint,
                  size: 56,
                  color: theme.colorScheme.primary,
                ),
              ),
              const SizedBox(height: 32),
              Text(
                'AIPiloty',
                style: theme.textTheme.headlineMedium?.copyWith(
                  fontWeight: FontWeight.bold,
                ),
              ),
              const SizedBox(height: 8),
              Text(
                'Authenticate to continue',
                style: theme.textTheme.bodyMedium?.copyWith(
                  color: theme.colorScheme.onSurface.withValues(alpha: 0.6),
                ),
              ),
              const SizedBox(height: 40),
              if (_error != null) ...[
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
                  decoration: BoxDecoration(
                    color: theme.colorScheme.errorContainer,
                    borderRadius: BorderRadius.circular(8),
                  ),
                  child: Text(
                    _error!,
                    style: TextStyle(color: theme.colorScheme.error),
                  ),
                ),
                const SizedBox(height: 16),
              ],
              FilledButton.icon(
                onPressed: _authenticating ? null : _authenticate,
                icon: _authenticating
                    ? const SizedBox(
                        width: 18,
                        height: 18,
                        child: CircularProgressIndicator(strokeWidth: 2),
                      )
                    : const Icon(Icons.fingerprint),
                label: Text(_authenticating ? 'Authenticating…' : 'Unlock'),
                style: FilledButton.styleFrom(
                  minimumSize: const Size(200, 50),
                ),
              ),
              const SizedBox(height: 16),
              TextButton(
                onPressed: widget.onAuthenticated,
                child: const Text('Skip for now'),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
