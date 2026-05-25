import { Terminal } from 'lucide-react';
import { Card } from '../components/ui/Card';

export default function SSH() {
  return (
    <div className="space-y-3">
      <Card title="SSH & SFTP Verwaltung">
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <div className="p-4 bg-panel-surface rounded-xl mb-4">
            <Terminal size={36} className="text-panel-muted" />
          </div>
          <p className="text-panel-text font-medium">SSH-Terminal & SFTP</p>
          <p className="text-panel-muted text-sm mt-2">Wird in Kürze implementiert</p>
          <div className="mt-6 text-xs text-panel-muted max-w-sm space-y-1">
            <p>Geplante Features:</p>
            <p className="text-panel-text">• Web-basiertes SSH-Terminal</p>
            <p className="text-panel-text">• SFTP-Dateimanager</p>
            <p className="text-panel-text">• SSH-Key-Verwaltung</p>
            <p className="text-panel-text">• Verbindungsprofile speichern</p>
          </div>
        </div>
      </Card>
    </div>
  );
}
