import 'package:flutter_riverpod/flutter_riverpod.dart';

/// Holds the session key that Sessions screen wants to resume in Chat.
/// Chat screen reads this on initState; Sessions screen writes it before switching tabs.
final activeSessionKeyProvider = StateProvider<String?>((ref) => null);

/// Shared home-shell tab index so any screen can switch tabs.
final homeTabIndexProvider = StateProvider<int>((ref) => 0);
