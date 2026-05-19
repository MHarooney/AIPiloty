import 'dart:async';

import 'package:connectivity_plus/connectivity_plus.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

/// Whether the device currently has network connectivity.
///
/// Returns `true` when at least one non-none connection is available.
final connectivityProvider = StreamNotifierProvider<ConnectivityNotifier, bool>(
  ConnectivityNotifier.new,
);

class ConnectivityNotifier extends StreamNotifier<bool> {
  @override
  Stream<bool> build() async* {
    final connectivity = Connectivity();
    // Emit initial state
    final initial = await connectivity.checkConnectivity();
    yield _isConnected(initial);
    // Then listen for changes
    await for (final result in connectivity.onConnectivityChanged) {
      yield _isConnected(result);
    }
  }

  static bool _isConnected(List<ConnectivityResult> results) {
    return results.any((r) => r != ConnectivityResult.none);
  }
}
