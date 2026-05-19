import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:dio/dio.dart';

import '../../core/network/api_client.dart';
import '../../core/providers/session_provider.dart';

class DashboardScreen extends ConsumerStatefulWidget {
  const DashboardScreen({super.key});

  @override
  ConsumerState<DashboardScreen> createState() => _DashboardScreenState();
}

class _DashboardScreenState extends ConsumerState<DashboardScreen> {
  bool _loading = true;
  String? _error;

  int _activeDeployments = 0;
  int _totalVMs = 0;
  int _chatSessions = 0;
  int _ragDocs = 0;
  String _apiStatus = 'unknown';
  Map<String, dynamic> _infra = {};

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() { _loading = true; _error = null; });
    try {
      final dio = ref.read(dioProvider);
      final results = await Future.wait([
        dio.get('/api/v1/infrastructure/stats').catchError((_) => Response(requestOptions: RequestOptions(path: ''), data: null)),
        dio.get('/api/v1/health').catchError((_) => Response(requestOptions: RequestOptions(path: ''), data: null)),
        dio.get('/api/v1/deployments/').catchError((_) => Response(requestOptions: RequestOptions(path: ''), data: [])),
        dio.get('/api/v1/vms/').catchError((_) => Response(requestOptions: RequestOptions(path: ''), data: [])),
        dio.get('/api/v1/sessions/').catchError((_) => Response(requestOptions: RequestOptions(path: ''), data: [])),
        dio.get('/api/v1/knowledge/?limit=1').catchError((_) => Response(requestOptions: RequestOptions(path: ''), data: null)),
      ]);

      final infraData   = results[0].data;
      final healthData  = results[1].data;
      final deplData    = results[2].data;
      final vmsData     = results[3].data;
      final sessData    = results[4].data;
      final kbData      = results[5].data;

      List _toList(dynamic d) {
        if (d is List) return d;
        if (d is Map) return (d['items'] ?? d['deployments'] ?? d['vms'] ?? d['sessions'] ?? []) as List;
        return [];
      }

      final deplList  = _toList(deplData);
      final active    = deplList.where((e) => e is Map && ['running','active','deployed'].contains(e['status'])).length;

      final vmsList   = _toList(vmsData);
      final sessList  = _toList(sessData);

      String apiSt = 'healthy';
      if (healthData is Map) apiSt = healthData['status']?.toString() ?? 'healthy';

      int kbCount = 0;
      if (kbData is Map) kbCount = kbData['total'] as int? ?? (kbData['items'] is List ? (kbData['items'] as List).length : 0);
      if (infraData is Map) kbCount = infraData['rag_documents'] as int? ?? kbCount;

      setState(() {
        _infra             = infraData is Map ? Map<String, dynamic>.from(infraData) : {};
        _activeDeployments = active;
        _totalVMs          = vmsList.length;
        _chatSessions      = sessList.length;
        _ragDocs           = kbCount;
        _apiStatus         = apiSt;
        _loading           = false;
      });
    } catch (e) {
      setState(() { _error = 'Error: $e'; _loading = false; });
    }
  }

  void _switchTab(int index) {
    ref.read(homeTabIndexProvider.notifier).state = index;
  }

  @override
  Widget build(BuildContext context) {
    final cs = Theme.of(context).colorScheme;
    return Scaffold(
      appBar: AppBar(
        title: const Text('Dashboard'),
        actions: [IconButton(icon: const Icon(Icons.refresh), onPressed: _load)],
      ),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : _error != null
              ? _errorView(cs)
              : RefreshIndicator(
                  onRefresh: _load,
                  child: ListView(
                    padding: const EdgeInsets.fromLTRB(12, 12, 12, 32),
                    children: [
                      _sectionLabel('Overview'),
                      const SizedBox(height: 8),
                      GridView.count(
                        crossAxisCount: 2,
                        shrinkWrap: true,
                        physics: const NeverScrollableScrollPhysics(),
                        mainAxisSpacing: 10,
                        crossAxisSpacing: 10,
                        childAspectRatio: 1.5,
                        children: [
                          _statCard(cs, 'Active Deployments', _activeDeployments.toString(), Icons.rocket_launch, Colors.indigo),
                          _statCard(cs, 'Total VMs', _totalVMs.toString(), Icons.dns, Colors.teal),
                          _statCard(cs, 'Chat Sessions', _chatSessions.toString(), Icons.chat_bubble_outline, Colors.orange),
                          _statCard(cs, 'RAG Docs', _ragDocs.toString(), Icons.library_books_outlined, Colors.purple),
                        ],
                      ),
                      const SizedBox(height: 16),
                      _apiStatusCard(cs),
                      const SizedBox(height: 16),
                      _sectionLabel('Quick Actions'),
                      const SizedBox(height: 8),
                      Row(children: [
                        Expanded(child: _actionBtn(cs, 'Chat', Icons.chat_bubble, Colors.indigo, () => _switchTab(0))),
                        const SizedBox(width: 8),
                        Expanded(child: _actionBtn(cs, 'Deployments', Icons.rocket_launch, Colors.blue, () => _switchTab(2))),
                        const SizedBox(width: 8),
                        Expanded(child: _actionBtn(cs, 'VMs', Icons.dns, Colors.teal, () => _switchTab(4))),
                      ]),
                      if (_infra.isNotEmpty) ...[
                        const SizedBox(height: 16),
                        _sectionLabel('Infrastructure Stats'),
                        const SizedBox(height: 8),
                        _infraCard(cs),
                      ],
                    ],
                  ),
                ),
    );
  }

  Widget _sectionLabel(String text) => Text(
        text,
        style: TextStyle(fontSize: 11, fontWeight: FontWeight.w600, color: Theme.of(context).colorScheme.onSurface.withOpacity(0.5), letterSpacing: 0.8),
      );

  Widget _statCard(ColorScheme cs, String label, String value, IconData icon, Color color) => Card(
        elevation: 0,
        color: cs.surfaceContainerHighest.withOpacity(0.45),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14), side: BorderSide(color: cs.outline.withOpacity(0.12))),
        child: Padding(
          padding: const EdgeInsets.fromLTRB(14, 12, 14, 12),
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, mainAxisAlignment: MainAxisAlignment.spaceBetween, children: [
            Row(children: [
              Icon(icon, color: color, size: 20),
              const Spacer(),
            ]),
            Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text(value, style: TextStyle(fontSize: 24, fontWeight: FontWeight.bold, color: color)),
              Text(label, style: TextStyle(fontSize: 11, color: cs.onSurface.withOpacity(0.6))),
            ]),
          ]),
        ),
      );

  Widget _apiStatusCard(ColorScheme cs) {
    final isOk = _apiStatus == 'healthy' || _apiStatus == 'ok';
    final color = isOk ? Colors.green : Colors.orange;
    return Card(
      elevation: 0,
      color: color.withOpacity(0.08),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14), side: BorderSide(color: color.withOpacity(0.3))),
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
        child: Row(children: [
          Icon(isOk ? Icons.check_circle_outline : Icons.warning_amber_outlined, color: color),
          const SizedBox(width: 10),
          Text('API Status', style: TextStyle(fontWeight: FontWeight.w600, color: cs.onSurface)),
          const Spacer(),
          Text(_apiStatus.toUpperCase(), style: TextStyle(fontWeight: FontWeight.bold, color: color, fontSize: 12)),
        ]),
      ),
    );
  }

  Widget _actionBtn(ColorScheme cs, String label, IconData icon, Color color, VoidCallback onTap) => InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(12),
        child: Container(
          padding: const EdgeInsets.symmetric(vertical: 14),
          decoration: BoxDecoration(
            color: color.withOpacity(0.1),
            borderRadius: BorderRadius.circular(12),
            border: Border.all(color: color.withOpacity(0.25)),
          ),
          child: Column(children: [
            Icon(icon, color: color, size: 22),
            const SizedBox(height: 4),
            Text(label, style: TextStyle(fontSize: 12, color: color, fontWeight: FontWeight.w600)),
          ]),
        ),
      );

  Widget _infraCard(ColorScheme cs) => Card(
        elevation: 0,
        color: cs.surfaceContainerHighest.withOpacity(0.45),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14), side: BorderSide(color: cs.outline.withOpacity(0.12))),
        child: Padding(
          padding: const EdgeInsets.all(14),
          child: Column(
            children: _infra.entries.map((e) => Padding(
              padding: const EdgeInsets.symmetric(vertical: 3),
              child: Row(children: [
                Text(e.key, style: TextStyle(fontSize: 12, color: cs.onSurface.withOpacity(0.65))),
                const Spacer(),
                Text(e.value.toString(), style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w600)),
              ]),
            )).toList(),
          ),
        ),
      );

  Widget _errorView(ColorScheme cs) => Center(
        child: Column(mainAxisSize: MainAxisSize.min, children: [
          Icon(Icons.error_outline, color: cs.error, size: 40),
          const SizedBox(height: 12),
          Text(_error!, style: TextStyle(color: cs.error), textAlign: TextAlign.center),
          const SizedBox(height: 12),
          FilledButton.icon(onPressed: _load, icon: const Icon(Icons.refresh), label: const Text('Retry')),
        ]),
      );
}
