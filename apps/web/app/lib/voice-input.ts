import type {Lang} from '@fintwin/contracts';

export type SpeechInputError = 'permission'|'unsupported'|'empty'|'failed'|'device'|'busy'|'auth'|'billing'|'budget'|'rate'|'session'|'timeout'|'format';
export function transcriptionError(code:unknown,status:number):SpeechInputError {
  if(code==='provider_auth_failed')return 'auth';
  if(code==='openai_billing_required')return 'billing';
  if(code==='budget_exhausted'||code==='paid_disabled')return 'budget';
  if(code==='provider_rate_limited'||status===429)return 'rate';
  if(status===401)return 'session';
  if(status===413||status===422)return 'format';
  return 'failed';
}
export function microphoneError(error:unknown):SpeechInputError {
  const name=(error as {name?:string})?.name;
  if(name==='NotAllowedError'||name==='SecurityError')return 'permission';
  if(name==='NotFoundError'||name==='OverconstrainedError')return 'device';
  if(name==='NotReadableError'||name==='AbortError')return 'busy';
  return 'failed';
}
export function inputErrorMessage(kind:SpeechInputError,lang:Lang):string {
  const messages:Record<SpeechInputError,[string,string]>={
    permission:['Microphone access was blocked. Allow microphone access for this site in your browser and system settings, then try again.','Mikrofonzugriff blockiert. Erlauben Sie ihn für diese Website im Browser und in den Systemeinstellungen.'],
    unsupported:['This browser cannot record audio. Open the site in Chrome or Safari over HTTPS.','Dieser Browser kann kein Audio aufnehmen. Öffnen Sie die Website in Chrome oder Safari über HTTPS.'],
    empty:['No speech was detected. Check the selected microphone and its input level, then try again.','Keine Sprache erkannt. Prüfen Sie das ausgewählte Mikrofon und seinen Eingangspegel.'],
    device:['The selected microphone is no longer available. Choose System default or another microphone.','Das gewählte Mikrofon ist nicht verfügbar. Wählen Sie Systemstandard oder ein anderes Mikrofon.'],
    busy:['The microphone could not start. Close other recordings and check your microphone connection.','Das Mikrofon konnte nicht starten. Beenden Sie andere Aufnahmen und prüfen Sie die Verbindung.'],
    auth:['Recording stopped: the transcription provider rejected API access. The presenter must update the private server key; changing microphone permissions will not fix this.','Aufnahme beendet: Der Transkriptionsanbieter verweigert den API-Zugriff. Der private Serverschlüssel muss aktualisiert werden.'],
    billing:['OpenAI transcription needs available API credits. Check API billing and limits; your recording was not sent to chat.','OpenAI-Transkription benötigt verfügbares API-Guthaben. Prüfen Sie Abrechnung und Limits; nichts wurde an den Chat gesendet.'],
    budget:['Voice is disabled or its usage allowance is exhausted. You can continue typing.','Sprache ist deaktiviert oder das Nutzungslimit ist erreicht. Sie können weiter tippen.'],
    rate:['Transcription is temporarily rate-limited. Wait a moment before recording again.','Die Transkription ist kurzzeitig begrenzt. Warten Sie vor der nächsten Aufnahme.'],
    session:['Your sign-in expired. Reload and sign in before recording again.','Ihre Anmeldung ist abgelaufen. Laden Sie die Seite neu und melden Sie sich an.'],
    timeout:['Transcription timed out. No message was sent. Check your connection and try a shorter recording.','Zeitüberschreitung bei der Transkription. Nichts wurde gesendet. Prüfen Sie die Verbindung und nehmen Sie kürzer auf.'],
    format:['The recording format or size was not accepted. Try a shorter recording in another browser.','Aufnahmeformat oder Größe nicht akzeptiert. Versuchen Sie eine kürzere Aufnahme in einem anderen Browser.'],
    failed:['Transcription could not finish. No message was sent. Check your connection and try again.','Die Transkription konnte nicht beendet werden. Nichts wurde gesendet. Prüfen Sie die Verbindung.'],
  };
  return messages[kind][lang==='de'?1:0];
}
