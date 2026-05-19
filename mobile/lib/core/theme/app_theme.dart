import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';

class AppTheme {
  AppTheme._();

  // ── Brand Colors ──────────────────────────────
  static const _indigo = Color(0xFF6366F1);
  static const _indigoLight = Color(0xFF818CF8);
  static const _darkBg = Color(0xFF0F1117);
  static const _darkSurface = Color(0xFF16181D);
  static const _darkCard = Color(0xFF1A1D24);
  static const _borderDark = Color(0xFF2A2D35);

  static final dark = ThemeData(
    brightness: Brightness.dark,
    useMaterial3: true,
    colorSchemeSeed: _indigo,
    textTheme: GoogleFonts.interTextTheme(ThemeData.dark().textTheme),
    scaffoldBackgroundColor: _darkBg,
    appBarTheme: AppBarTheme(
      backgroundColor: _darkBg.withAlpha(200),
      elevation: 0,
      centerTitle: true,
      surfaceTintColor: Colors.transparent,
      titleTextStyle: GoogleFonts.inter(
        fontSize: 18,
        fontWeight: FontWeight.w600,
        color: Colors.white,
      ),
    ),
    navigationBarTheme: NavigationBarThemeData(
      backgroundColor: _darkSurface.withAlpha(230),
      indicatorColor: _indigo.withAlpha(40),
      labelTextStyle: WidgetStateProperty.resolveWith((states) {
        if (states.contains(WidgetState.selected)) {
          return GoogleFonts.inter(fontSize: 11, fontWeight: FontWeight.w600, color: _indigoLight);
        }
        return GoogleFonts.inter(fontSize: 11, color: Colors.grey);
      }),
    ),
    inputDecorationTheme: InputDecorationTheme(
      filled: true,
      fillColor: _darkCard,
      contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
      border: OutlineInputBorder(
        borderRadius: BorderRadius.circular(14),
        borderSide: const BorderSide(color: _borderDark),
      ),
      enabledBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(14),
        borderSide: const BorderSide(color: _borderDark),
      ),
      focusedBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(14),
        borderSide: const BorderSide(color: _indigo, width: 1.5),
      ),
    ),
    cardTheme: CardThemeData(
      color: _darkSurface,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
      elevation: 0,
      margin: const EdgeInsets.symmetric(horizontal: 16, vertical: 6),
    ),
    dialogTheme: DialogThemeData(
      backgroundColor: _darkSurface,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(20)),
      elevation: 8,
    ),
    bottomSheetTheme: BottomSheetThemeData(
      backgroundColor: _darkSurface,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
      ),
    ),
    chipTheme: ChipThemeData(
      backgroundColor: _darkCard,
      selectedColor: _indigo.withAlpha(50),
      labelStyle: GoogleFonts.inter(fontSize: 12),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
      side: const BorderSide(color: _borderDark),
    ),
    elevatedButtonTheme: ElevatedButtonThemeData(
      style: ElevatedButton.styleFrom(
        backgroundColor: _indigo,
        foregroundColor: Colors.white,
        elevation: 0,
        padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 14),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
        textStyle: GoogleFonts.inter(fontSize: 14, fontWeight: FontWeight.w600),
      ),
    ),
    outlinedButtonTheme: OutlinedButtonThemeData(
      style: OutlinedButton.styleFrom(
        foregroundColor: _indigoLight,
        side: const BorderSide(color: _borderDark),
        padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 12),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
      ),
    ),
    floatingActionButtonTheme: const FloatingActionButtonThemeData(
      backgroundColor: _indigo,
      foregroundColor: Colors.white,
      elevation: 4,
      shape: CircleBorder(),
    ),
    dividerTheme: const DividerThemeData(
      color: _borderDark,
      thickness: 0.5,
    ),
    snackBarTheme: SnackBarThemeData(
      backgroundColor: _darkCard,
      behavior: SnackBarBehavior.floating,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
    ),
  );

  // ── Glass-style decorations for widgets ──────
  static BoxDecoration glassCard({double opacity = 0.08}) => BoxDecoration(
    color: Colors.white.withAlpha((opacity * 255).round()),
    borderRadius: BorderRadius.circular(16),
    border: Border.all(color: Colors.white.withAlpha(20)),
  );

  static BoxDecoration gradientCard({
    List<Color> colors = const [Color(0xFF6366F1), Color(0xFF8B5CF6)],
    double opacity = 0.15,
  }) => BoxDecoration(
    gradient: LinearGradient(
      colors: colors.map((c) => c.withAlpha((opacity * 255).round())).toList(),
      begin: Alignment.topLeft,
      end: Alignment.bottomRight,
    ),
    borderRadius: BorderRadius.circular(16),
    border: Border.all(color: colors.first.withAlpha(40)),
  );

  static BoxDecoration statusBadge(Color color) => BoxDecoration(
    color: color.withAlpha(30),
    borderRadius: BorderRadius.circular(8),
    border: Border.all(color: color.withAlpha(80)),
  );
}
