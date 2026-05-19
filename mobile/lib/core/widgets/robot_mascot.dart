import 'dart:math';
import 'package:flutter/material.dart';

/// Animated robot mascot widget — bounces and glows based on [phase].
///
/// Phases: idle, thinking, working, success, error
/// Used as a compact avatar or decorative element in app shell.
class RobotMascot extends StatefulWidget {
  final String phase;
  final double size;

  const RobotMascot({
    super.key,
    this.phase = 'idle',
    this.size = 64,
  });

  @override
  State<RobotMascot> createState() => _RobotMascotState();
}

class _RobotMascotState extends State<RobotMascot>
    with SingleTickerProviderStateMixin {
  late AnimationController _controller;
  late Animation<double> _bounce;
  late Animation<double> _glow;

  @override
  void initState() {
    super.initState();
    _controller = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 1500),
    )..repeat(reverse: true);

    _bounce = Tween<double>(begin: 0, end: -6).animate(
      CurvedAnimation(parent: _controller, curve: Curves.easeInOut),
    );
    _glow = Tween<double>(begin: 0.3, end: 0.8).animate(
      CurvedAnimation(parent: _controller, curve: Curves.easeInOut),
    );
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  Color _phaseColor() {
    switch (widget.phase) {
      case 'thinking':
        return Colors.amber;
      case 'working':
        return Colors.blue;
      case 'success':
        return Colors.green;
      case 'error':
        return Colors.red;
      default:
        return Colors.indigo;
    }
  }

  IconData _phaseIcon() {
    switch (widget.phase) {
      case 'thinking':
        return Icons.psychology;
      case 'working':
        return Icons.build;
      case 'success':
        return Icons.check_circle;
      case 'error':
        return Icons.error;
      default:
        return Icons.smart_toy;
    }
  }

  @override
  Widget build(BuildContext context) {
    final color = _phaseColor();
    final isAnimating = widget.phase == 'thinking' || widget.phase == 'working';

    return AnimatedBuilder(
      animation: _controller,
      builder: (context, child) {
        return Transform.translate(
          offset: Offset(0, isAnimating ? _bounce.value : 0),
          child: Container(
            width: widget.size,
            height: widget.size,
            decoration: BoxDecoration(
              shape: BoxShape.circle,
              gradient: RadialGradient(
                colors: [
                  color.withValues(alpha: _glow.value),
                  color.withValues(alpha: 0.1),
                ],
              ),
              boxShadow: [
                BoxShadow(
                  color: color.withValues(alpha: isAnimating ? _glow.value * 0.5 : 0.15),
                  blurRadius: isAnimating ? 20 : 8,
                  spreadRadius: isAnimating ? 4 : 1,
                ),
              ],
            ),
            child: Center(
              child: Icon(
                _phaseIcon(),
                size: widget.size * 0.5,
                color: Colors.white,
              ),
            ),
          ),
        );
      },
    );
  }
}

/// Utility: AnimatedBuilder is just AnimatedWidget in disguise
class AnimatedBuilder extends AnimatedWidget {
  final Widget Function(BuildContext context, Widget? child) builder;
  final Widget? child;

  const AnimatedBuilder({
    super.key,
    required Animation<double> animation,
    required this.builder,
    this.child,
  }) : super(listenable: animation);

  @override
  Widget build(BuildContext context) {
    return builder(context, child);
  }
}
