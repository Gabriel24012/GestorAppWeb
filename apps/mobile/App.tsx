import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Animated, Clipboard, FlatList, Image, Modal, Pressable, ScrollView, StyleSheet, Text as NativeText, TextInput as NativeTextInput, useWindowDimensions, View } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { StatusBar } from 'expo-status-bar';
import { ApiEnvelope, Profile, api, currentUser, downloadApi, getPreferences, login, logout, savePreferences, uploadProfileImage } from './src/api';

type Section = 'Inicio' | 'Captura' | 'Registros' | 'Gestores' | 'Capturadores' | 'Equipo' | 'Metas' | 'Configuración';
type AnyRow = Record<string, any>;
type RecordFilters = { q: string; capturer_id: string; date_from: string; date_to: string; address: string; district: string; neighborhood: string; postal_code: string };
type RecordFilterOptions = { addresses: string[]; districts: string[]; neighborhoods: string[]; postal_codes: string[] };
const EMPTY_RECORD_FILTERS: RecordFilters = { q: '', capturer_id: '', date_from: '', date_to: '', address: '', district: '', neighborhood: '', postal_code: '' };
const DETAIL_RECORDS_LIMIT = 10;
const RECORD_FIELDS: Array<[string, string, string, 'default' | 'numeric' | 'phone-pad']> = [
  ['first_name', 'Nombre(s)', 'First name(s)', 'default'], ['paternal_surname', 'Apellido paterno', 'Paternal surname', 'default'], ['maternal_surname', 'Apellido materno (opcional)', 'Maternal surname (optional)', 'default'],
  ['address', 'Domicilio', 'Address', 'default'], ['exterior_number', 'Número exterior', 'Street number', 'default'], ['neighborhood', 'Colonia', 'Neighborhood', 'default'],
  ['district', 'Municipio o distrito', 'Municipality or district', 'default'], ['postal_code', 'Código postal', 'Postal code', 'numeric'], ['birth_date', 'Fecha de nacimiento (AAAA-MM-DD)', 'Birth date (YYYY-MM-DD)', 'default'],
  ['phone', 'Teléfono', 'Phone', 'phone-pad'], ['electoral_key', 'Clave electoral', 'Voter ID key', 'default'], ['observations', 'Observaciones (opcional)', 'Notes (optional)', 'default']
];
const today = () => new Date().toISOString().slice(0, 10);
let fontScale = 1;
let currentLanguage: 'es' | 'en' = 'es';
function tr(es: string, en: string) { return currentLanguage === 'en' ? en : es; }
function Text(props: React.ComponentProps<typeof NativeText>) {
  const style = StyleSheet.flatten(props.style);
  return <NativeText {...props} style={style?.fontSize ? {...style, fontSize: style.fontSize * fontScale} : props.style} />;
}
function TextInput(props: React.ComponentProps<typeof NativeTextInput>) {
  return <NativeTextInput {...props} placeholderTextColor={C.placeholder} selectionColor={C.accent} keyboardAppearance={C.mode} />;
}

export default function App() {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [profileImageBusy, setProfileImageBusy] = useState(false);
  const [error, setError] = useState('');
  const [section, setSection] = useState<Section>('Inicio');
  const [menuOpen, setMenuOpen] = useState(false);
  const [drawerMounted, setDrawerMounted] = useState(false);
  const menuProgress = useRef(new Animated.Value(0)).current;
  const { width: screenWidth } = useWindowDimensions();
  const drawerWidth = Math.min(380, screenWidth * 0.86);
  const [payload, setPayload] = useState<any>(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [recordDraft, setRecordDraft] = useState<Record<string, string>>({});
  const [captureSessionId, setCaptureSessionId] = useState('');
  const [inviteName, setInviteName] = useState('');
  const [inviteEmail, setInviteEmail] = useState('');
  const [managerId, setManagerId] = useState('');
  const [inviteLink, setInviteLink] = useState('');
  const [inviteLinkOwner, setInviteLinkOwner] = useState('');
  const [inviteLinkSection, setInviteLinkSection] = useState<Section | null>(null);
  const [inviteLinkDescription, setInviteLinkDescription] = useState('');
  const [notice, setNotice] = useState('');
  const [goalCapturerId, setGoalCapturerId] = useState('');
  const [goalTarget, setGoalTarget] = useState('10');
  const [goalStart, setGoalStart] = useState(today());
  const [goalEnd, setGoalEnd] = useState(new Date(Date.now() + 6 * 86400000).toISOString().slice(0, 10));
  const [detail, setDetail] = useState<AnyRow | null>(null);
  const [detailTitle, setDetailTitle] = useState('');
  const [detailCapturerId, setDetailCapturerId] = useState('');
  const [detailRecords, setDetailRecords] = useState<AnyRow[]>([]);
  const [detailRecordsPage, setDetailRecordsPage] = useState(1);
  const [detailRecordsTotal, setDetailRecordsTotal] = useState(0);
  const [detailRecordsLoading, setDetailRecordsLoading] = useState(false);
  const [editingRecord, setEditingRecord] = useState<AnyRow | null>(null);
  const [recordEditDraft, setRecordEditDraft] = useState<Record<string, string>>({});
  const [recordMutationBusy, setRecordMutationBusy] = useState(false);
  const [demoDataBusy, setDemoDataBusy] = useState(false);
  const [recordFilters, setRecordFilters] = useState<RecordFilters>(EMPTY_RECORD_FILTERS);
  const [appliedRecordFilters, setAppliedRecordFilters] = useState<RecordFilters>(EMPTY_RECORD_FILTERS);
  const [recordsPage, setRecordsPage] = useState(1);
  const [recordsTotal, setRecordsTotal] = useState(0);
  const [recordCapturers, setRecordCapturers] = useState<AnyRow[]>([]);
  const [recordFilterOptions, setRecordFilterOptions] = useState<RecordFilterOptions | null>(null);
  const [recordsPageSize, setRecordsPageSize] = useState(DETAIL_RECORDS_LIMIT);
  const [recordsSearching, setRecordsSearching] = useState(false);
  const [exportBusy, setExportBusy] = useState(false);
  const recordsRequest = useRef(0);
  const [preferences, setPreferences] = useState<{theme:'light'|'dark';font_size:'small'|'normal'|'large';language:'es'|'en'}>({theme:'light',font_size:'normal',language:'es'});
  C = preferences.theme === 'dark' ? DARK_COLORS : LIGHT_COLORS;
  styles = STYLE_CACHE[preferences.theme];
  currentLanguage = preferences.language;
  fontScale = preferences.font_size === 'small' ? 0.88 : preferences.font_size === 'large' ? 1.15 : 1;

  function changeSection(next: Section) {
    setSection(next);
    setMenuOpen(false);
    setDetail(null);
    setDetailCapturerId('');
    setDetailRecords([]);
    setDetailRecordsPage(1);
    setDetailRecordsTotal(0);
    setEditingRecord(null);
    setInviteLink('');
    setInviteLinkOwner('');
    setInviteLinkSection(null);
    setInviteLinkDescription('');
    setNotice('');
    setError('');
  }

  useEffect(() => { currentUser().then(setProfile).catch(() => {}).finally(() => setLoading(false)); getPreferences().then(setPreferences).catch(() => {}); }, []);
  useEffect(() => { if (profile) { void loadSection(); getPreferences().then(setPreferences).catch(() => {}); } }, [profile, section]);
  useEffect(() => {
    if (menuOpen) setDrawerMounted(true);
    const animation = Animated.timing(menuProgress, { toValue: menuOpen ? 1 : 0, duration: 260, useNativeDriver: true });
    animation.start(({ finished }) => { if (finished && !menuOpen) setDrawerMounted(false); });
    return () => animation.stop();
  }, [menuOpen, menuProgress]);

  const tabs = useMemo<Section[]>(() => {
    if (!profile) return [];
    if (profile.role === 'admin') return ['Inicio', 'Gestores', 'Equipo', 'Registros', 'Metas', 'Configuración'];
    if (profile.role === 'gestor') return ['Inicio', 'Capturadores', 'Registros', 'Metas', 'Configuración'];
    return ['Inicio', 'Captura', 'Registros', 'Configuración'];
  }, [profile]);

  const menuContent = <>
    <View style={styles.drawerHeader}><Text style={styles.drawerTitle}>{tr('Menú', 'Menu')}</Text><Pressable accessibilityRole="button" accessibilityLabel={tr('Cerrar menú', 'Close menu')} onPress={() => setMenuOpen(false)} style={styles.drawerClose}><Text style={styles.drawerCloseText}>×</Text></Pressable></View>
    <ScrollView style={styles.drawerScroll} contentContainerStyle={styles.drawerItems}>
      {tabs.map(item => <Pressable key={item} accessibilityRole="button" onPress={() => changeSection(item)} style={[styles.drawerItem, section === item && styles.drawerItemActive]}><Text style={styles.drawerItemText}>{sectionLabel(item)}</Text></Pressable>)}
    </ScrollView>
    <View style={styles.drawerFooter}><Pressable accessibilityRole="button" onPress={() => { setMenuOpen(false); void logout().then(() => { setProfile(null); setPayload(null); }); }} style={styles.drawerExitButton}><Text style={styles.drawerExitText}>{tr('Salir', 'Sign out')}</Text></Pressable></View>
  </>;

  async function loadSection() {
    if (!profile) return;
    if (section === 'Configuración') { setPayload({}); setLoading(false); return; }
    if (section === 'Registros') { await loadRecordsPage(1, appliedRecordFilters); return; }
    setLoading(true); setError(''); setDetail(null);
    try {
      let path = '/dashboard/admin';
      if (section === 'Inicio') path = profile.role === 'admin' ? '/admin/managers' : profile.role === 'gestor' ? '/dashboard/gestor' : '/capture-context';
      else if (section === 'Captura') path = '/capture-context';
      else if (section === 'Gestores') path = '/gestores?role=gestor';
      else if (section === 'Capturadores') path = profile.role === 'gestor' ? '/capturadores' : '/capturadores';
      else if (section === 'Equipo') path = '/capturadores';
      else if (section === 'Metas') path = '/manager/goals';
      const result = await api<any>(path);
      setPayload(result);
      const data = unwrap(result);
      if ((section === 'Inicio' || section === 'Captura') && profile.role === 'capturador') setCaptureSessionId(data?.capture_session_id || '');
      if (section === 'Equipo' && profile.role === 'admin') {
        const managers = await api<any>('/admin/managers');
        const capturers = await api<any>('/capturadores');
        setPayload({ managers: unwrap(managers), capturers: unwrap(capturers) });
      }
      if (section === 'Metas') {
        const managers = profile.role === 'admin' ? await api<any>('/admin/managers') : null;
        const capturers = await api<any>('/capturadores');
        setPayload({ goals: data, managers: managers ? unwrap(managers) : [], capturers: unwrap(capturers) });
      }
      if (section === 'Capturadores' && profile.role === 'gestor') {
        const detailed = await api<any>('/manager/capturers');
        const statsById = new Map(asArray(unwrap(detailed)).map(row => [row.id, row]));
        setPayload(asArray(data).map(row => ({ ...row, ...(statsById.get(row.id) || {}) })));
      }
    } catch (e) { setError(message(e)); }
    finally { setLoading(false); }
  }

  async function submitLogin() {
    setLoading(true); setError('');
    try { const user = await login(email.trim(), password); setProfile(user); setSection('Inicio'); setPassword(''); }
    catch (e) { setError(message(e)); }
    finally { setLoading(false); }
  }

  async function resendVerification() {
    try { await api('/auth/resend-verification', { method:'POST', body:JSON.stringify({email:email.trim()}) }, false); Alert.alert(tr('Revisa tu correo', 'Check your email'), tr('Si la cuenta requiere verificación, enviamos un enlace.', 'If the account requires verification, we sent a link.')); }
    catch (e) { setError(message(e)); }
  }

  async function selectProfileImage() {
    setError(''); setNotice('');
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) { Alert.alert(tr('Permiso necesario', 'Permission required'), tr('Permite acceso a tus fotos para elegir una imagen de perfil.', 'Allow photo access to choose a profile image.')); return; }
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes:['images'], allowsEditing:true, aspect:[1,1], quality:0.85 });
    if (!result.canceled && result.assets[0]) {
      setProfileImageBusy(true);
      try {
        const asset = result.assets[0];
        const uri = await uploadProfileImage(asset.uri);
        setProfile(p=>p?{...p,profile_image:uri}:p);
        setNotice(tr('Foto de perfil actualizada.', 'Profile photo updated.'));
        Alert.alert(tr('Foto actualizada', 'Photo updated'), tr('Tu nueva foto de perfil se guardó correctamente.', 'Your new profile photo was saved successfully.'));
      } catch(e) {
        const detail = message(e);
        console.error('Profile image upload failed', e);
        setError(detail);
        Alert.alert(tr('No se pudo subir la foto', 'Could not upload photo'), detail);
      }
      finally { setProfileImageBusy(false); }
    }
  }

  async function updatePreference<K extends keyof typeof preferences>(key: K, value: typeof preferences[K]) {
    const next = {...preferences, [key]:value}; setPreferences(next); try { await savePreferences(next); } catch(e) { setError(message(e)); }
  }

  async function removeProfileImage() {
    setError(''); setNotice(''); setProfileImageBusy(true);
    try {
      await api('/profile/image', {method:'DELETE'});
      setProfile(p=>p?{...p,profile_image:''}:p);
      setNotice(tr('Foto de perfil eliminada.', 'Profile photo removed.'));
      Alert.alert(tr('Foto eliminada', 'Photo removed'), tr('La foto de perfil se eliminó correctamente.', 'The profile photo was removed successfully.'));
    }
    catch(e) {
      const detail = message(e);
      setError(detail);
      Alert.alert(tr('No se pudo eliminar la foto', 'Could not remove photo'), detail);
    }
    finally { setProfileImageBusy(false); }
  }

  function confirmRemoveProfileImage() {
    Alert.alert(tr('Eliminar foto', 'Remove photo'), tr('¿Quieres quitar tu foto de perfil?', 'Do you want to remove your profile photo?'), [
      { text: tr('Cancelar', 'Cancel'), style: 'cancel' },
      { text: tr('Eliminar', 'Remove'), style: 'destructive', onPress: () => { void removeProfileImage(); } }
    ]);
  }

  async function submitRecord() {
    setError('');
    const body = { ...recordDraft, electoral_key: recordDraft.electoral_key?.trim().toUpperCase(), capture_session_id: captureSessionId || null, section_code: 'GENERAL' };
    await api('/records', { method: 'POST', body: JSON.stringify(body) });
    setRecordDraft({});
    Alert.alert(tr('Registro guardado', 'Record saved'), tr('El registro se agregó correctamente.', 'The record was added successfully.'));
    if (section === 'Registros') await loadRecordsPage(1, appliedRecordFilters);
    else changeSection('Registros');
  }

  async function loadRecordsPage(page: number, filters: RecordFilters = appliedRecordFilters, refreshCapturers = false, limit = recordsPageSize, live = false) {
    if (!profile) return;
    const requestId = ++recordsRequest.current;
    if (!live) setLoading(true);
    setError(''); setDetail(null); setEditingRecord(null);
    try {
      const path = profile.role === 'admin' ? '/admin/records' : profile.role === 'gestor' ? '/manager/records' : '/records';
      const query = queryString({ ...filters, status: 'active', page, limit });
      const result = await api<ApiEnvelope<AnyRow[]>>(`${path}?${query}`);
      if (requestId !== recordsRequest.current) return;
      setPayload(result);
      setRecordsPage(result.meta?.page || page);
      setRecordsTotal(result.meta?.total ?? asArray(result.data).length);
      if (profile.role !== 'capturador' && (refreshCapturers || !recordCapturers.length)) {
        try {
          const members = await api<any>(profile.role === 'admin' ? '/capturadores' : '/manager/capturers');
          setRecordCapturers(asArray(unwrap(members)).filter(row => row.kind !== 'invite'));
        } catch (e) { setError(message(e)); }
      }
      if (!live && profile.role !== 'capturador' && (refreshCapturers || !recordFilterOptions)) {
        const scope = profile.role === 'admin' ? 'admin' : 'manager';
        const options = await api<ApiEnvelope<RecordFilterOptions>>(`/${scope}/record-filter-options`);
        setRecordFilterOptions(options.data);
      }
    } catch (e) { if (requestId === recordsRequest.current) setError(message(e)); }
    finally {
      if (requestId === recordsRequest.current) {
        setLoading(false);
        setRecordsSearching(false);
      }
    }
  }

  useEffect(() => {
    if (section !== 'Registros' || detail) {
      setRecordsSearching(false);
      return;
    }
    if (recordFilters.q === appliedRecordFilters.q) return;
    setRecordsSearching(true);
    const timer = setTimeout(() => {
      const next = { ...appliedRecordFilters, q: recordFilters.q };
      setAppliedRecordFilters(next);
      void loadRecordsPage(1, next, false, recordsPageSize, true);
    }, 300);
    return () => clearTimeout(timer);
  }, [section, detail, recordFilters.q, appliedRecordFilters.q, recordsPageSize]);

  async function exportRecords() {
    setExportBusy(true);
    setError('');
    try {
      if (!await Sharing.isAvailableAsync()) throw new Error(tr('Este dispositivo no permite compartir archivos.', 'This device cannot share files.'));
      const query = queryString({ ...appliedRecordFilters, status: 'active', format: 'xlsx' });
      const bytes = await downloadApi(`/exports/records?${query}`);
      const file = new File(Paths.cache, `registros-${Date.now()}.xlsx`);
      file.create();
      file.write(bytes);
      await Sharing.shareAsync(file.uri, { mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', UTI: 'org.openxmlformats.spreadsheetml.sheet' });
    } catch (e) { setError(message(e)); }
    finally { setExportBusy(false); }
  }

  function applyRecordsFilter() {
    const next = { ...recordFilters };
    setAppliedRecordFilters(next);
    setEditingRecord(null);
    void loadRecordsPage(1, next);
  }

  function clearRecordsFilter() {
    const next = { ...EMPTY_RECORD_FILTERS };
    setRecordFilters(next);
    setAppliedRecordFilters(next);
    setEditingRecord(null);
    void loadRecordsPage(1, next);
  }

  function confirmCreateDemoData() {
    Alert.alert(tr('Insertar datos demo', 'Insert demo data'), tr('Se crearán 5 gestores, 25 capturadores y 500 registros completos. La demo anterior será reemplazada.', 'This will create 5 managers, 25 capturers, and 500 complete records. The previous demo will be replaced.'), [
      { text: tr('Cancelar', 'Cancel'), style: 'cancel' },
      { text: tr('Insertar demo', 'Insert demo'), onPress: () => { void createDemoData(); } }
    ]);
  }

  async function createDemoData() {
    setDemoDataBusy(true); setError(''); setNotice('');
    try {
      const result = await api<{data: {managers: number; capturers: number; records: number}}>('/admin/demo-data', { method: 'POST', body: JSON.stringify({}) });
      setNotice(currentLanguage === 'en' ? `Demo inserted: ${result.data.managers} managers, ${result.data.capturers} capturers, and ${result.data.records} records.` : `Demo insertada: ${result.data.managers} gestores, ${result.data.capturers} capturadores y ${result.data.records} registros.`);
      setRecordFilters(EMPTY_RECORD_FILTERS);
      setAppliedRecordFilters(EMPTY_RECORD_FILTERS);
      await loadRecordsPage(1, EMPTY_RECORD_FILTERS, true);
    } catch (e) { setError(message(e)); }
    finally { setDemoDataBusy(false); }
  }

  function confirmDeleteDemoData() {
    Alert.alert(tr('Eliminar datos demo', 'Delete demo data'), tr('Solo se eliminarán los gestores, capturadores y registros marcados como demo.', 'Only managers, capturers, and records marked as demo will be deleted.'), [
      { text: tr('Cancelar', 'Cancel'), style: 'cancel' },
      { text: tr('Eliminar demo', 'Delete demo'), style: 'destructive', onPress: () => { void deleteDemoData(); } }
    ]);
  }

  async function deleteDemoData() {
    setDemoDataBusy(true); setError(''); setNotice('');
    try {
      const result = await api<{data: {managers: number; capturers: number; records: number}}>('/admin/demo-data', { method: 'DELETE' });
      setNotice(currentLanguage === 'en' ? `Demo deleted: ${result.data.managers} managers, ${result.data.capturers} capturers, and ${result.data.records} records.` : `Demo eliminada: ${result.data.managers} gestores, ${result.data.capturers} capturadores y ${result.data.records} registros.`);
      setRecordFilters(EMPTY_RECORD_FILTERS);
      setAppliedRecordFilters(EMPTY_RECORD_FILTERS);
      await loadRecordsPage(1, EMPTY_RECORD_FILTERS, true);
    } catch (e) { setError(message(e)); }
    finally { setDemoDataBusy(false); }
  }

  async function createInvite(role: 'gestor' | 'capturador') {
    setError(''); setNotice(''); setInviteLink('');
    try {
      const path = role === 'gestor' ? '/admin/manager-invite-links' : '/capturadores/invite-links';
      const result = await api<any>(path, { method: 'POST', body: JSON.stringify({ placeholder_name: inviteName, email: inviteEmail.trim() }) });
      const link = result?.data?.link || '';
      const owner = inviteRecipient(result?.data?.placeholder_name || inviteName, result?.data?.email || inviteEmail.trim(), role);
      setInviteLink(link);
      setInviteLinkOwner(owner);
      setInviteLinkSection(section);
      setInviteLinkDescription(currentLanguage === 'en' ? `New invitation for ${owner}.` : `Invitación nueva para ${owner}.`);
      setNotice(result?.data?.email_sent === false ? result?.data?.warning || tr('El correo no se envió. Copia y comparte el enlace.', 'The email was not sent. Copy and share the link.') : currentLanguage === 'en' ? `Invitation sent to ${owner}.` : `Invitación enviada a ${owner}.`);
      setInviteName(''); setInviteEmail(''); await loadSection();
    } catch (e) { setError(message(e)); }
  }

  async function resendMemberInvite(id: string, role: 'gestor' | 'capturador') {
    setError(''); setNotice('');
    try {
      const path = role === 'gestor' ? `/admin/manager-invites/${id}/resend-email` : `/capturadores/${id}/resend-email`;
      const result = await api<any>(path, {method:'POST',body:JSON.stringify({})});
      if (result?.data?.email_sent) setNotice(currentLanguage === 'en' ? `Invitation email resent to ${result?.data?.recipient_email || 'the registered address'}.` : `Correo de invitación reenviado a ${result?.data?.recipient_email || 'la dirección registrada'}.`);
      else setError(result?.data?.warning || tr('Resend no pudo enviar el correo. Revisa la configuración de correo de la API.', 'Resend could not send the email. Check the API email configuration.'));
    } catch(e) { setError(message(e)); }
  }

  async function generateMemberLink(id: string, role: 'gestor' | 'capturador') {
    setError(''); setNotice('');
    try {
      const path = role === 'gestor' ? `/admin/manager-invites/${id}/resend-or-copy` : `/capturadores/${id}/resend-or-copy`;
      const result = await api<any>(path, {method:'POST',body:JSON.stringify({})});
      const link = result?.data?.link || '';
      const owner = inviteRecipient(result?.data?.placeholder_name || result?.data?.full_name, result?.data?.recipient_email || result?.data?.email, role);
      setInviteLink(link);
      setInviteLinkOwner(owner);
      setInviteLinkSection(section);
      setInviteLinkDescription(currentLanguage === 'en' ? `New link for ${owner}. The previous link is no longer valid.` : `Enlace nuevo para ${owner}. El enlace anterior dejó de ser válido.`);
      const copied = await copyToClipboard(link);
      setNotice(copied ? (currentLanguage === 'en' ? `New link for ${owner}; copied to the clipboard. The previous link is no longer valid.` : `Enlace nuevo para ${owner}; se copió al portapapeles. El anterior dejó de ser válido.`) : (currentLanguage === 'en' ? `A new link was generated for ${owner}, but it could not be copied. The previous link is no longer valid.` : `Se generó un enlace nuevo para ${owner}, pero no se pudo copiar. El anterior dejó de ser válido.`));
      if (!copied) setError(tr('Mantén pulsado el enlace para seleccionarlo y copiarlo.', 'Press and hold the link to select and copy it.'));
    } catch(e) { setError(message(e)); }
  }

  async function copyInviteLink() {
    setError(''); setNotice('');
    const copied = await copyToClipboard(inviteLink);
    if (copied) setNotice(currentLanguage === 'en' ? `Link for ${inviteLinkOwner || 'the invitation'} copied to the clipboard.` : `Enlace de ${inviteLinkOwner || 'la invitación'} copiado al portapapeles.`);
    else setError(tr('No se pudo copiar el enlace. Mantén pulsado el texto del enlace para seleccionarlo y copiarlo.', 'The link could not be copied. Press and hold it to select and copy it.'));
  }

  async function copyToClipboard(value: string) {
    if (!value) return false;
    try {
      Clipboard.setString(value);
      return (await Clipboard.getString()) === value;
    } catch { return false; }
  }

  async function createGoal() {
    setError('');
    try {
      const admin = profile?.role === 'admin';
      const path = admin ? '/admin/manager-goals' : '/manager/goals';
      const targetId = admin ? managerId : goalCapturerId;
      if (admin && !targetId) throw new Error(tr('Selecciona el gestor que recibirá la meta.', 'Select the manager who will receive the goal.'));
      if (!/^[1-9]\d*$/.test(goalTarget.trim())) throw new Error(tr('Escribe una cantidad entera mayor que cero.', 'Enter a whole number greater than zero.'));
      if (goalEnd < goalStart) throw new Error(tr('La fecha de fin debe ser igual o posterior a la de inicio.', 'The end date must be on or after the start date.'));
      await api(path, { method: 'POST', body: JSON.stringify({ ...(admin ? { manager_id: targetId } : { capturer_id: targetId || null }), period_type: 'weekly', target_count: Number(goalTarget), starts_on: goalStart, ends_on: goalEnd }) });
      Alert.alert(tr('Meta creada', 'Goal created'), tr('La meta quedó registrada.', 'The goal was saved.')); await loadSection();
    } catch (e) { setError(message(e)); }
  }

  async function openManager(id: string, name: string) {
    setLoading(true); setError('');
    try { const result = await api<any>(`/admin/managers/${id}`); setDetail(unwrap(result)); setDetailTitle(name); }
    catch (e) { setError(message(e)); }
    finally { setLoading(false); }
  }

  async function openCapturer(id: string, name: string) {
    setLoading(true); setError('');
    try {
      if (profile?.role === 'gestor') {
        const result = await api<any>(`/manager/capturers/${id}`);
        setDetail(unwrap(result));
      } else {
        const result = await api<any>('/capturadores');
        setDetail({ capturer: asArray(unwrap(result)).find(row => row.id === id) || { id, full_name: name } });
      }
      setDetailCapturerId(id);
      setDetailTitle(name);
      await loadCapturerRecords(id, 1);
    } catch (e) { setError(message(e)); }
    finally { setLoading(false); }
  }

  async function loadCapturerRecords(capturerId: string, page: number) {
    if (!profile || !capturerId) return;
    setDetailRecordsLoading(true); setError(''); setEditingRecord(null);
    try {
      const path = profile.role === 'admin' ? '/admin/records' : '/manager/records';
      const result = await api<ApiEnvelope<AnyRow[]>>(`${path}?capturer_id=${encodeURIComponent(capturerId)}&status=active&page=${page}&limit=${DETAIL_RECORDS_LIMIT}`);
      setDetailRecords(asArray(result.data));
      setDetailRecordsPage(result.meta?.page || page);
      setDetailRecordsTotal(result.meta?.total ?? result.data.length);
    } catch (e) { setError(message(e)); }
    finally { setDetailRecordsLoading(false); }
  }

  function beginRecordEdit(record: AnyRow) {
    setEditingRecord(record);
    setRecordEditDraft(Object.fromEntries(RECORD_FIELDS.map(([name]) => [name, record[name] == null ? '' : String(record[name])])));
    setError(''); setNotice('');
  }

  async function saveRecordEdit() {
    if (!editingRecord) return;
    setRecordMutationBusy(true); setError(''); setNotice('');
    try {
      await api(`/records/${editingRecord.id}`, { method: 'PATCH', body: JSON.stringify({ ...recordEditDraft, electoral_key: recordEditDraft.electoral_key?.trim().toUpperCase() }) });
      setEditingRecord(null);
      setNotice(tr('Registro actualizado correctamente.', 'Record updated successfully.'));
      if (detailCapturerId) await loadCapturerRecords(detailCapturerId, detailRecordsPage);
      else await loadRecordsPage(recordsPage, appliedRecordFilters);
    } catch (e) { setError(message(e)); }
    finally { setRecordMutationBusy(false); }
  }

  function confirmDeleteRecord(record: AnyRow) {
    const name = [record.first_name, record.paternal_surname].filter(Boolean).join(' ') || tr('este registro', 'this record');
    Alert.alert(tr('Eliminar registro', 'Delete record'), currentLanguage === 'en' ? `Delete ${name}? It will be removed from the active records, but its audit history will be preserved.` : `¿Eliminar ${name}? Dejará de aparecer entre los registros activos, pero se conservará su historial de auditoría.`, [
      { text: tr('Cancelar', 'Cancel'), style: 'cancel' },
      { text: tr('Eliminar', 'Delete'), style: 'destructive', onPress: () => { void deleteRecord(record); } }
    ]);
  }

  async function deleteRecord(record: AnyRow) {
    setRecordMutationBusy(true); setError(''); setNotice('');
    try {
      await api(`/records/${record.id}`, { method: 'DELETE' });
      const remaining = Math.max(0, detailRecordsTotal - 1);
      const lastPage = Math.max(1, Math.ceil(remaining / DETAIL_RECORDS_LIMIT));
      const nextPage = Math.min(detailRecordsPage, lastPage);
      setEditingRecord(current => current?.id === record.id ? null : current);
      setNotice(tr('Registro eliminado correctamente.', 'Record deleted successfully.'));
      if (detailCapturerId) {
        setDetail(current => current ? { ...current, total_records: Math.max(0, Number(current.total_records || 0) - 1) } : current);
        await loadCapturerRecords(detailCapturerId, nextPage);
      } else {
        const generalRemaining = Math.max(0, recordsTotal - 1);
        const generalLastPage = Math.max(1, Math.ceil(generalRemaining / recordsPageSize));
        await loadRecordsPage(Math.min(recordsPage, generalLastPage), appliedRecordFilters);
      }
    } catch (e) { setError(message(e)); }
    finally { setRecordMutationBusy(false); }
  }

  async function toggleProfileFavorite(row: AnyRow) {
    setError('');
    try {
      await api(`/favorites/profiles/${row.id}`, { method: 'POST', body: JSON.stringify({}) });
      await loadSection();
    } catch (e) { setError(message(e)); }
  }

  async function toggleRecordFavorite(row: AnyRow) {
    setError('');
    try {
      await api(`/favorites/records/${row.id}`, { method: 'POST', body: JSON.stringify({}) });
      await loadRecordsPage(recordsPage, appliedRecordFilters);
    } catch (e) { setError(message(e)); }
  }

  async function toggleProfile(row: AnyRow, role: 'gestor' | 'capturador') {
    const id = row.id;
    try {
      await api(`/${role === 'gestor' ? 'gestores' : 'capturadores'}/${id}`, { method: 'PATCH', body: JSON.stringify({ is_active: !row.is_active }) });
      setDetail(null); await loadSection();
    } catch (e) { setError(message(e)); }
  }

  function confirmDeleteProfile(row: AnyRow, role: 'gestor' | 'capturador') {
    const name = row.full_name || row.email || role;
    Alert.alert(currentLanguage === 'en' ? `Delete ${roleLabel(role)}` : `Borrar ${roleLabel(role)}`, currentLanguage === 'en' ? `Delete ${name} permanently? This cannot be undone. If associated members or records exist, the server will prevent deletion and explain why.` : `¿Borrar permanentemente a ${name}? La acción no se puede deshacer. Si tiene miembros o registros asociados, el servidor impedirá el borrado y explicará por qué.`, [
      { text: tr('Cancelar', 'Cancel'), style: 'cancel' },
      { text: tr('Borrar', 'Delete'), style: 'destructive', onPress: () => { void deleteProfile(row, role); } }
    ]);
  }

  async function deleteProfile(row: AnyRow, role: 'gestor' | 'capturador') {
    setError('');
    try {
      await api(`/${role === 'gestor' ? 'gestores' : 'capturadores'}/${row.id}`, { method: 'DELETE' });
      setDetail(null);
      await loadSection();
      Alert.alert(tr('Cuenta eliminada', 'Account deleted'), role === 'gestor' ? tr('El gestor se eliminó permanentemente.', 'The manager was permanently deleted.') : tr('El capturador se eliminó permanentemente.', 'The capturer was permanently deleted.'));
    } catch (e) { setError(message(e)); }
  }

  if (loading && !profile) return <View style={styles.center}><ActivityIndicator size="large" color={C.accent} /><Text style={styles.muted}>{tr('Cargando sesión…', 'Loading session…')}</Text></View>;
  if (!profile) return <View style={styles.login}><StatusBar style="light" /><View style={styles.loginBox}><Text style={styles.loginBrand}>{tr('Gestión de Captura', 'Capture Management')}</Text><Text style={styles.subtitle}>{tr('Inicia sesión con tu cuenta', 'Sign in to your account')}</Text><TextInput style={styles.input} placeholder={tr('Correo', 'Email')} autoCapitalize="none" keyboardType="email-address" value={email} onChangeText={setEmail} /><TextInput style={styles.input} placeholder={tr('Contraseña', 'Password')} secureTextEntry value={password} onChangeText={setPassword} />{error ? <Text style={styles.error}>{error}</Text> : null}{error.includes('email_not_verified') ? <Action title={tr('Reenviar verificación', 'Resend verification')} secondary onPress={()=>void resendVerification()} /> : null}<Action title={loading ? tr('Entrando…', 'Signing in…') : tr('Entrar', 'Sign in')} onPress={() => void submitLogin()} disabled={loading} /></View></View>;


  const data = unwrap(payload);
  const roleName = profile.role === 'admin' ? tr('Administrador', 'Administrator') : profile.role === 'gestor' ? tr('Gestor', 'Manager') : tr('Capturador', 'Capturer');
  return <View style={styles.page}><StatusBar style="light" />
    <View style={styles.header}>
      <View style={styles.headerRow}>
        {profile.profile_image ? <Image source={{uri:profile.profile_image}} style={styles.avatarImage}/> : <View style={styles.brandMark}><Text style={styles.brandMarkText}>GC</Text></View>}
        <View style={styles.headerText}><Text style={styles.brand}>{tr('Gestión de Captura', 'Capture Management')}</Text><Text style={styles.headerUser}>{profile.full_name}</Text></View>
        <Pressable style={styles.menuToggle} accessibilityRole="button" accessibilityLabel={menuOpen ? tr('Cerrar menú', 'Close menu') : tr('Abrir menú', 'Open menu')} accessibilityState={{ expanded: menuOpen }} onPress={() => setMenuOpen(open => !open)}>
          <View style={styles.hamburgerLines}><View style={styles.hamburgerLine}/><View style={styles.hamburgerLine}/><View style={styles.hamburgerLine}/></View>
        </Pressable>
      </View>
      <Text style={styles.rolePill}>{roleName}</Text>
    </View>
    <ScrollView contentContainerStyle={styles.content}>
      {section !== 'Configuración' && inviteLink && inviteLinkSection === section ? <View style={styles.linkBox}><Text style={styles.fieldLabel}>{tr('Enlace para:', 'Link for:')} {inviteLinkOwner}</Text><Text selectable style={styles.link}>{inviteLink}</Text><Text style={styles.rowMeta}>{inviteLinkDescription}</Text><Action compact title={tr('Copiar enlace', 'Copy link')} onPress={() => void copyInviteLink()} /></View> : null}
      <View style={styles.pageTitle}><Text style={styles.heading}>{detail ? detailTitle : sectionLabel(section)}</Text><Text style={styles.muted}>{detail ? tr('Resumen y actividad', 'Summary and activity') : subtitleFor(section, profile.role)}</Text></View>
      {error ? <Text style={styles.error}>{error}</Text> : null}
      {notice ? <Text style={styles.notice}>{notice}</Text> : null}
      {detail ? <DetailView detail={detail} role={profile.role} records={detailRecords} recordsPage={detailRecordsPage} recordsTotal={detailRecordsTotal} recordsLoading={detailRecordsLoading} recordMutationBusy={recordMutationBusy} editingRecord={editingRecord} recordEditDraft={recordEditDraft} setRecordEditDraft={setRecordEditDraft} onBack={() => { setDetail(null); setDetailCapturerId(''); setDetailRecords([]); setEditingRecord(null); }} onToggle={(row, role) => void toggleProfile(row, role)} onDelete={confirmDeleteProfile} onRecordsPage={page => void loadCapturerRecords(detailCapturerId, page)} onEditRecord={beginRecordEdit} onCancelRecordEdit={() => setEditingRecord(null)} onSaveRecordEdit={() => void saveRecordEdit()} onDeleteRecord={confirmDeleteRecord} /> : loading ? <ActivityIndicator color={C.accent} style={{ marginTop: 28 }} /> : <>
        {section === 'Configuración' ? <>
          <Card title={tr('Correo y cuenta', 'Email and account')}><Text style={styles.rowSub}>{profile.email_verified ? tr('Correo verificado', 'Email verified') : tr('Correo pendiente de verificación', 'Email verification pending')}</Text>{!profile.email_verified ? <Action title={tr('Reenviar verificación', 'Resend verification')} secondary onPress={() => void resendVerification()} /> : null}</Card>
          <Card title={tr('Apariencia', 'Appearance')}>
            <Text style={styles.fieldLabel}>{tr('Tema', 'Theme')}</Text><ChoiceList rows={[{id:'light',full_name:tr('Claro', 'Light')},{id:'dark',full_name:tr('Oscuro', 'Dark')}]} value={preferences.theme} onSelect={v=>void updatePreference('theme',v as 'light'|'dark')} placeholder=""/>
            <Text style={styles.fieldLabel}>{tr('Tamaño del texto', 'Text size')}</Text><ChoiceList rows={[{id:'small',full_name:tr('Pequeño','Small')},{id:'normal',full_name:tr('Normal','Normal')},{id:'large',full_name:tr('Grande','Large')}]} value={preferences.font_size} onSelect={v=>void updatePreference('font_size',v as 'small'|'normal'|'large')} placeholder=""/>
            <Text style={styles.fieldLabel}>{tr('Idioma', 'Language')}</Text><ChoiceList rows={[{id:'es',full_name:'Español'},{id:'en',full_name:'English'}]} value={preferences.language} onSelect={v=>void updatePreference('language',v as 'es'|'en')} placeholder=""/>
          </Card>
          <Card title={tr('Perfil', 'Profile')}><View style={styles.personRow}>{profile.profile_image ? <Image source={{uri:profile.profile_image}} style={styles.avatarImage}/> : <View style={styles.avatar}><Text style={styles.avatarText}>{initials(profile.full_name)}</Text></View>}<Text style={styles.rowTitle}>{profile.full_name}</Text></View><Action title={profileImageBusy ? tr('Procesando…', 'Processing…') : tr('Cambiar foto de perfil', 'Change profile photo')} disabled={profileImageBusy} onPress={()=>void selectProfileImage()}/>{profile.profile_image?<Action title={profileImageBusy ? tr('Procesando…', 'Processing…') : tr('Eliminar foto', 'Remove photo')} disabled={profileImageBusy} secondary onPress={confirmRemoveProfileImage}/>:null}</Card>
        </> : null}
        {section === 'Inicio' && profile.role === 'admin' ? <AdminHome rows={asArray(data)} onOpen={openManager} onFavorite={row => void toggleProfileFavorite(row)} /> : null}
        {section === 'Inicio' && profile.role === 'gestor' ? <ManagerHome data={data} onSection={changeSection} /> : null}
        {section === 'Inicio' && profile.role === 'capturador' ? <CapturerHome data={data} onSection={changeSection} /> : null}
        {section === 'Captura' && profile.role === 'capturador' ? <RecordForm draft={recordDraft} setDraft={setRecordDraft} onSubmit={submitRecord} /> : null}
        {section === 'Gestores' && profile.role === 'admin' ? <><ManagerList rows={asArray(data)} onOpen={openManager} onFavorite={row=>void toggleProfileFavorite(row)} onResend={id=>void resendMemberInvite(id,'gestor')} onGenerateLink={id=>void generateMemberLink(id,'gestor')} /><InviteForm role="admin" inviteName={inviteName} setInviteName={setInviteName} inviteEmail={inviteEmail} setInviteEmail={setInviteEmail} onInvite={createInvite} /></> : null}
        {section === 'Capturadores' && profile.role === 'gestor' ? <><CapturerList rows={asArray(data)} onOpen={openCapturer} onFavorite={row=>void toggleProfileFavorite(row)} onResend={id=>void resendMemberInvite(id,'capturador')} onGenerateLink={id=>void generateMemberLink(id,'capturador')} /><InviteForm role="gestor" inviteName={inviteName} setInviteName={setInviteName} inviteEmail={inviteEmail} setInviteEmail={setInviteEmail} onInvite={createInvite} /></> : null}
        {section === 'Equipo' ? profile.role === 'admin' ? <AdminTeam managers={asArray(data?.managers)} capturers={asArray(data?.capturers)} onOpenManager={openManager} onOpenCapturer={openCapturer} onFavoriteManager={row=>void toggleProfileFavorite(row)} onResendManager={id=>void resendMemberInvite(id,'gestor')} onGenerateManagerLink={id=>void generateMemberLink(id,'gestor')} onResendCapturer={id=>void resendMemberInvite(id,'capturador')} onGenerateCapturerLink={id=>void generateMemberLink(id,'capturador')} /> : <CapturerList rows={asArray(data)} onOpen={openCapturer} onFavorite={row=>void toggleProfileFavorite(row)} onResend={id=>void resendMemberInvite(id,'capturador')} onGenerateLink={id=>void generateMemberLink(id,'capturador')} /> : null}
        {section === 'Registros' ? <>
          <Card title={tr('Buscar registros', 'Search records')}>
            <TextInput style={styles.input} placeholder={tr('Nombre, teléfono, clave electoral o domicilio', 'Name, phone, voter ID key, or address')} value={recordFilters.q} onChangeText={q => setRecordFilters(current => ({ ...current, q }))} autoCorrect={false} />
            <FilterPicker label={tr('Registros por página', 'Records per page')} choices={[10, 25, 50, 100].map(size => ({ id: String(size), label: String(size) }))} value={String(recordsPageSize)} onSelect={value => { const limit = Number(value); setRecordsPageSize(limit); void loadRecordsPage(1, appliedRecordFilters, false, limit, true); }} allowEmpty={false} />
            <Action secondary disabled={exportBusy || recordsSearching || !recordsTotal || recordFilters.q !== appliedRecordFilters.q} title={exportBusy ? tr('Preparando Excel…', 'Preparing Excel…') : tr('Exportar Excel', 'Export Excel')} onPress={() => void exportRecords()} />
          </Card>
          {profile.role === 'capturador' ? <RecordForm draft={recordDraft} setDraft={setRecordDraft} onSubmit={submitRecord} /> : null}
          {profile.role === 'admin' && profile.demo_data_enabled === true ? <Card title={tr('Datos demo', 'Demo data')} subtitle={tr('Crea 5 gestores, 5 capturadores por gestor y 20 registros completos por capturador.', 'Create 5 managers, 5 capturers per manager, and 20 complete records per capturer.')}><Action title={demoDataBusy ? tr('Procesando…', 'Processing…') : tr('Insertar demo', 'Insert demo')} disabled={demoDataBusy} onPress={confirmCreateDemoData} /><Action title={tr('Eliminar demo', 'Delete demo')} disabled={demoDataBusy} danger onPress={confirmDeleteDemoData} /></Card> : null}
          {profile.role !== 'capturador' ? <RecordsFilterCard filters={recordFilters} setFilters={setRecordFilters} capturers={recordCapturers} options={recordFilterOptions} onApply={applyRecordsFilter} onClear={clearRecordsFilter} /> : null}
          {editingRecord ? <RecordEditForm draft={recordEditDraft} setDraft={setRecordEditDraft} busy={recordMutationBusy} onSave={() => void saveRecordEdit()} onCancel={() => setEditingRecord(null)} /> : null}
          <RecordsList rows={asArray(data)} total={recordsTotal} page={recordsPage} limit={recordsPageSize} loading={recordsSearching} busy={recordMutationBusy} onPage={page => void loadRecordsPage(page, appliedRecordFilters)} onEdit={beginRecordEdit} onDelete={confirmDeleteRecord} onToggleFavorite={profile.role === 'capturador' ? row => void toggleRecordFavorite(row) : undefined} />
        </> : null}
        {section === 'Metas' ? <GoalsView data={data} role={profile.role} managers={asArray((payload as any)?.managers)} capturers={asArray((payload as any)?.capturers)} managerId={managerId} setManagerId={setManagerId} goalCapturerId={goalCapturerId} setGoalCapturerId={setGoalCapturerId} goalTarget={goalTarget} setGoalTarget={setGoalTarget} goalStart={goalStart} setGoalStart={setGoalStart} goalEnd={goalEnd} setGoalEnd={setGoalEnd} onCreate={() => void createGoal()} /> : null}
      </>}
    </ScrollView>
    {drawerMounted ? <View style={styles.drawerOverlay} pointerEvents={menuOpen ? 'auto' : 'none'}>
      <Animated.View style={[styles.drawerBackdrop, { opacity: menuProgress.interpolate({ inputRange: [0, 1], outputRange: [0, 0.48] }) }]}>
        <Pressable accessibilityRole="button" accessibilityLabel={tr('Cerrar menú', 'Close menu')} onPress={() => setMenuOpen(false)} style={StyleSheet.absoluteFill} />
      </Animated.View>
      <Animated.View style={[styles.drawerPanel, { width: drawerWidth, transform: [{ translateX: menuProgress.interpolate({ inputRange: [0, 1], outputRange: [drawerWidth, 0] }) }] }]}>{menuContent}</Animated.View>
    </View> : null}
  </View>;
}

function AdminHome({ rows, onOpen, onFavorite }: { rows: AnyRow[]; onOpen: (id: string, name: string) => void; onFavorite: (row: AnyRow) => void }) {
  const managers = rows.filter(row => row.kind !== 'invite');
  const totalCapturers = managers.reduce((sum, row) => sum + Number(row.total_capturadores || 0), 0);
  const totalRecords = managers.reduce((sum, row) => sum + Number(row.total_records || 0), 0);
  return <><View style={styles.stats}><Stat label={tr('Gestores', 'Managers')} value={managers.length} /><Stat label={tr('Capturadores', 'Capturers')} value={totalCapturers} /><Stat label={tr('Registros', 'Records')} value={totalRecords} /></View><Card title={tr('Tus gestores', 'Your managers')} subtitle={tr('Abre un perfil para consultar su equipo y resultados.', 'Open a profile to view its team and results.')}>{managers.length ? managers.map(row => <ManagerRow key={row.id} row={row} onPress={() => onOpen(row.id, row.full_name)} onFavorite={() => onFavorite(row)} />) : <Empty text={tr('Todavía no hay gestores registrados.', 'There are no registered managers yet.')} />}</Card></>;
}

function ManagerHome({ data, onSection }: { data: AnyRow; onSection: (section: Section) => void }) {
  return <><View style={styles.stats}><Stat label={tr('Registros hoy', 'Records today')} value={data?.records_today || 0} /><Stat label={tr('Esta semana', 'This week')} value={data?.records_week || 0} /><Stat label={tr('Capturadores', 'Capturers')} value={data?.total_capturadores || 0} /></View><Card title={tr('Metas activas', 'Active goals')}>{asArray(data?.active_goals_list || data?.goals).length ? asArray(data?.active_goals_list || data?.goals).map((goal, i) => <GoalRow key={goal.id || i} goal={goal} />) : <Empty text={tr('No hay metas activas.', 'There are no active goals.')} />}</Card><Card title={tr('Actividad del equipo', 'Team activity')}><Rankings rows={asArray(data?.ranking)} /><Action title={tr('Ver capturadores', 'View capturers')} onPress={() => onSection('Capturadores')} /></Card><Card title={tr('Zonas con más registros', 'Areas with the most records')}><Rankings rows={asArray(data?.top_zones).map((r: AnyRow) => ({ full_name: r.zone, total_records: r.total }))} /></Card></>;
}

function CapturerHome({ data, onSection }: { data: AnyRow; onSection: (section: Section) => void }) {
  return <><Card title={tr('Tu jornada', 'Your workday')} subtitle={tr('Los registros se guardarán en la sesión de captura activa.', 'Records will be saved to the active capture session.')}><Info label={tr('Gestor', 'Manager')} value={data?.leadership_name || tr('Sin asignar', 'Unassigned')} /><Info label={tr('Sección', 'Section')} value={data?.section_code || tr('General', 'General')} /><Info label={tr('Sesión', 'Session')} value={data?.capture_session_id ? tr('Activa', 'Active') : tr('No disponible', 'Unavailable')} /><Action title={tr('Comenzar captura', 'Start capturing')} onPress={() => onSection('Captura')} /></Card><Card title={tr('Accesos rápidos', 'Quick actions')}><Action title={tr('Ver mis registros', 'View my records')} onPress={() => onSection('Registros')} /></Card></>;
}

function ManagerList({ rows, onOpen, onFavorite, onResend, onGenerateLink }: { rows: AnyRow[]; onOpen: (id: string, name: string) => void; onFavorite?: (row: AnyRow) => void; onResend?: (id: string) => void; onGenerateLink?: (id: string) => void }) {
  return <Card title={tr('Gestores', 'Managers')} subtitle={currentLanguage === 'en' ? `${rows.length} profiles` : `${rows.length} perfiles`}>
    {rows.length ? rows.map(row => row.kind === 'invite' ? <InviteRow key={row.id} row={row} onResend={onResend ? () => onResend(row.id) : undefined} onGenerateLink={onGenerateLink ? () => onGenerateLink(row.id) : undefined} /> : <ManagerRow key={row.id} row={row} onPress={() => onOpen(row.id, row.full_name)} onFavorite={onFavorite ? () => onFavorite(row) : undefined} />) : <Empty text={tr('No hay gestores disponibles.', 'No managers are available.')} />}
  </Card>;
}

function ManagerRow({ row, onPress, onFavorite }: { row: AnyRow; onPress: () => void; onFavorite?: () => void }) {
  return <Pressable onPress={onPress} style={styles.personRow}>{row.profile_image?<Image source={{uri:row.profile_image}} style={styles.avatarImage}/>:<View style={styles.avatar}><Text style={styles.avatarText}>{initials(row.full_name)}</Text></View>}<View style={styles.rowMain}><Text style={styles.rowTitle} numberOfLines={1}>{row.full_name || tr('Gestor', 'Manager')}</Text><Text style={styles.rowSub} numberOfLines={1}>{row.email || tr('Sin correo', 'No email')} · {row.is_active === false ? tr('Inactivo', 'Inactive') : tr('Activo', 'Active')}</Text><Text style={styles.rowMeta} numberOfLines={1}>{row.total_capturadores || 0} {tr('capturadores', 'capturers')} · {row.total_records || 0} {tr('registros', 'records')} · {row.email_verified ? tr('Verificado', 'Verified') : tr('Pendiente', 'Pending')}</Text></View>{onFavorite ? <HeartButton active={Boolean(row.is_favorite)} onPress={onFavorite} /> : null}<Text style={styles.chevron}>›</Text></Pressable>;
}

function CapturerList({ rows, onOpen, onFavorite, onResend, onGenerateLink }: { rows: AnyRow[]; onOpen: (id: string, name: string) => void; onFavorite?: (row: AnyRow) => void; onResend?: (id: string) => void; onGenerateLink?: (id: string) => void }) {
  return <Card title={tr('Equipo de captura', 'Capture team')} subtitle={currentLanguage === 'en' ? `${rows.length} members` : `${rows.length} integrantes`}>
    {rows.length ? rows.map((row, i) => row.kind === 'invite' ? <InviteRow key={row.id || i} row={row} onResend={onResend ? () => onResend(row.id) : undefined} onGenerateLink={onGenerateLink ? () => onGenerateLink(row.id) : undefined} /> : <Pressable key={row.id || i} style={styles.personRow} onPress={() => onOpen(row.id, row.full_name || tr('Capturador', 'Capturer'))}>{row.profile_image?<Image source={{uri:row.profile_image}} style={styles.avatarImage}/>:<View style={styles.avatar}><Text style={styles.avatarText}>{initials(row.placeholder_name || row.full_name)}</Text></View>}<View style={styles.rowMain}><Text style={styles.rowTitle} numberOfLines={1}>{row.full_name || row.placeholder_name || tr('Capturador', 'Capturer')}</Text><Text style={styles.rowSub} numberOfLines={1}>{row.email || tr('Sin correo', 'No email')} · {row.status_label || (row.is_active === false ? tr('Inactivo', 'Inactive') : tr('Activo', 'Active'))}</Text><Text style={styles.rowMeta} numberOfLines={1}>{row.total_records ?? 0} {tr('registros', 'records')} · {tr('Hoy', 'Today')} {row.records_today ?? 0} · {row.email_verified ? tr('Verificado', 'Verified') : tr('Pendiente', 'Pending')}</Text></View>{onFavorite ? <HeartButton active={Boolean(row.is_favorite)} onPress={() => onFavorite(row)} /> : null}<Text style={styles.chevron}>›</Text></Pressable>) : <Empty text={tr('Todavía no hay capturadores en el equipo.', 'There are no capturers on the team yet.')} />}
  </Card>;
}

function AdminTeam({ managers, capturers, onOpenManager, onOpenCapturer, onFavoriteManager, onResendManager, onGenerateManagerLink, onResendCapturer, onGenerateCapturerLink }: { managers: AnyRow[]; capturers: AnyRow[]; onOpenManager: (id: string, name: string) => void; onOpenCapturer: (id: string, name: string) => void; onFavoriteManager: (row: AnyRow) => void; onResendManager: (id: string) => void; onGenerateManagerLink: (id: string) => void; onResendCapturer: (id: string) => void; onGenerateCapturerLink: (id: string) => void }) {
  return <><ManagerList rows={managers} onOpen={onOpenManager} onFavorite={onFavoriteManager} onResend={onResendManager} onGenerateLink={onGenerateManagerLink} /><CapturerList rows={capturers} onOpen={onOpenCapturer} onResend={onResendCapturer} onGenerateLink={onGenerateCapturerLink} /></>;
}

function RecordsList({ rows, total, page, limit = DETAIL_RECORDS_LIMIT, loading = false, busy = false, onPage, onEdit, onDelete, onToggleFavorite }: { rows: AnyRow[]; total?: number; page?: number; limit?: number; loading?: boolean; busy?: boolean; onPage?: (page: number) => void; onEdit?: (row: AnyRow) => void; onDelete?: (row: AnyRow) => void; onToggleFavorite?: (row: AnyRow) => void }) {
  const pages = Math.max(1, Math.ceil((total ?? rows.length) / limit));
  return <Card title={tr('Registros recientes', 'Recent records')} subtitle={currentLanguage === 'en' ? `${total ?? rows.length} total` : `${total ?? rows.length} en total`}>
    {page && pages > 1 ? <View style={styles.pagination}><Pressable disabled={page <= 1 || loading} onPress={() => onPage?.(page - 1)} style={[styles.pageButton, (page <= 1 || loading) && styles.pageButtonDisabled]}><Text style={styles.pageButtonText}>{tr('Anterior', 'Previous')}</Text></Pressable><Text style={styles.pageSummary}>{tr('Página', 'Page')} {page} {tr('de', 'of')} {pages}</Text><Pressable disabled={page >= pages || loading} onPress={() => onPage?.(page + 1)} style={[styles.pageButton, (page >= pages || loading) && styles.pageButtonDisabled]}><Text style={styles.pageButtonText}>{tr('Siguiente', 'Next')}</Text></Pressable></View> : null}
    {loading ? <ActivityIndicator color={C.accent} style={{ marginVertical: 18 }} /> : rows.length ? rows.map((row, i) => <View key={row.id || i} style={styles.recordRow}><View style={styles.recordTop}><Text style={[styles.rowTitle, styles.recordTitle]}>{[row.first_name, row.paternal_surname, row.maternal_surname].filter(Boolean).join(' ') || tr('Registro', 'Record')}</Text><View style={styles.recordStatusActions}>{onToggleFavorite ? <HeartButton active={Boolean(row.is_favorite)} onPress={() => onToggleFavorite(row)} /> : null}<Text style={[styles.status, row.status === 'voided' && styles.statusOff]}>{row.status === 'voided' ? tr('Anulado', 'Voided') : tr('Activo', 'Active')}</Text></View></View><Text style={styles.rowSub}>{row.capturer?.full_name ? `${row.capturer.full_name} · ` : ''}{row.phone || tr('Sin teléfono', 'No phone')}</Text><Text style={styles.rowMeta}>{tr('Clave electoral', 'Voter ID key')}: {row.electoral_key || '—'}</Text><Text style={styles.rowMeta}>{row.address || tr('Sin domicilio', 'No address')} {row.exterior_number ? `#${row.exterior_number}` : ''}</Text><Text style={styles.rowMeta}>{row.neighborhood || tr('Sin colonia', 'No neighborhood')} · {row.district || tr('Sin distrito', 'No district')} · {row.postal_code || tr('Sin C.P.', 'No postal code')}</Text><Text style={styles.rowMeta}>{formatDate(row.created_at)} · {row.observations || tr('Sin observaciones', 'No notes')}</Text>{onEdit || onDelete ? <View style={styles.recordActions}>{onEdit ? <Action compact secondary disabled={busy} title={tr('Modificar', 'Edit')} onPress={() => onEdit(row)} /> : null}{onDelete ? <Action compact danger disabled={busy} title={tr('Eliminar', 'Delete')} onPress={() => onDelete(row)} /> : null}</View> : null}</View>) : <Empty text={tr('Aún no hay registros para mostrar.', 'There are no records to display yet.')} />}
  </Card>;
}

function HeartButton({ active, onPress }: { active: boolean; onPress: () => void }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={active ? tr('Quitar de favoritos', 'Remove from favorites') : tr('Agregar a favoritos', 'Add to favorites')} onPress={event => { event.stopPropagation(); onPress(); }} hitSlop={8} style={styles.heartButton}><Text style={[styles.heartText, active && styles.heartTextActive]}>{active ? '♥' : '♡'}</Text></Pressable>;
}

function RecordEditForm({ draft, setDraft, busy, onSave, onCancel }: { draft: Record<string, string>; setDraft: React.Dispatch<React.SetStateAction<Record<string, string>>>; busy: boolean; onSave: () => void; onCancel: () => void }) {
  return <Card title={tr('Modificar registro', 'Edit record')} subtitle={tr('Actualiza los datos y guarda los cambios.', 'Update the information and save your changes.')}>
    {RECORD_FIELDS.map(([name, labelEs, labelEn, keyboardType]) => <TextInput key={name} style={styles.input} placeholder={tr(labelEs, labelEn)} value={draft[name] || ''} keyboardType={keyboardType} autoCapitalize={name === 'electoral_key' ? 'characters' : 'sentences'} onChangeText={value => setDraft(current => ({ ...current, [name]: value }))} />)}
    <View style={styles.recordActions}><Action title={busy ? tr('Guardando…', 'Saving…') : tr('Guardar cambios', 'Save changes')} disabled={busy} compact onPress={onSave} /><Action title={tr('Cancelar', 'Cancel')} disabled={busy} compact secondary onPress={onCancel} /></View>
  </Card>;
}

function FilterPicker({ label, value, choices, onSelect, emptyLabel = tr('Todos', 'All'), allowEmpty = true }: { label: string; value: string; choices: { id: string; label: string }[]; onSelect: (id: string) => void; emptyLabel?: string; allowEmpty?: boolean }) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const normalize = (text: string) => text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const query = normalize(search.trim());
  const matches = open ? choices.filter(choice => normalize(choice.label).includes(query)) : [];
  function choose(id: string) {
    onSelect(id);
    setOpen(false);
  }
  return <View style={{ gap: 4 }}>
    <Text style={styles.fieldLabel}>{label}</Text>
    <Pressable style={styles.choice} accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ expanded: open }} onPress={() => { setSearch(''); setOpen(true); }}>
      <Text style={styles.choiceText}>{choices.find(choice => choice.id === value)?.label || value || emptyLabel}  ▾</Text>
    </Pressable>
    <Modal visible={open} animationType="slide" onRequestClose={() => setOpen(false)}>
      <View style={[styles.page, { paddingHorizontal: 18, paddingTop: 60, paddingBottom: 24, gap: 10 }]}>
        <Text style={styles.heading}>{label}</Text>
        <TextInput style={styles.input} placeholder={tr('Buscar opciones', 'Search options')} value={search} onChangeText={setSearch} />
        {allowEmpty ? <Choice label={emptyLabel} selected={!value} onPress={() => choose('')} /> : null}
        <FlatList data={matches} keyExtractor={item => item.id} keyboardShouldPersistTaps="handled"
          ListEmptyComponent={<Empty text={tr('No hay coincidencias.', 'No matches found.')} />}
          renderItem={({ item }) => <Choice label={item.label} selected={value === item.id} onPress={() => choose(item.id)} />} />
        <Action secondary title={tr('Cerrar', 'Close')} onPress={() => setOpen(false)} />
      </View>
    </Modal>
  </View>;
}

function RecordsFilterCard({ filters, setFilters, capturers, options, onApply, onClear }: { filters: RecordFilters; setFilters: React.Dispatch<React.SetStateAction<RecordFilters>>; capturers: AnyRow[]; options: RecordFilterOptions | null; onApply: () => void; onClear: () => void }) {
  const update = (key: keyof RecordFilters, value: string) => setFilters(current => ({ ...current, [key]: value }));
  const choices = (values: string[] = []) => values.map(value => ({ id: value, label: value }));
  return <Card title={tr('Filtrar registros', 'Filter records')} subtitle={tr('Busca y combina filtros como en el panel web.', 'Search and combine filters as in the web dashboard.')}>
    <FilterPicker label={tr('Capturador', 'Capturer')} choices={capturers.map(row => ({ id: row.id, label: row.full_name || row.email || row.id }))} value={filters.capturer_id} onSelect={value => update('capturer_id', value)} />
    <View style={styles.filterPair}><View style={styles.filterField}><Text style={styles.fieldLabel}>{tr('Desde', 'From')}</Text><TextInput style={styles.input} placeholder={tr('AAAA-MM-DD', 'YYYY-MM-DD')} value={filters.date_from} onChangeText={value => update('date_from', value)} /></View><View style={styles.filterField}><Text style={styles.fieldLabel}>{tr('Hasta', 'To')}</Text><TextInput style={styles.input} placeholder={tr('AAAA-MM-DD', 'YYYY-MM-DD')} value={filters.date_to} onChangeText={value => update('date_to', value)} /></View></View>
    <FilterPicker label={tr('Domicilio', 'Address')} choices={choices(options?.addresses)} value={filters.address} onSelect={value => update('address', value)} />
    <FilterPicker label={tr('Distrito', 'District')} choices={choices(options?.districts)} value={filters.district} onSelect={value => update('district', value)} />
    <FilterPicker label={tr('Fraccionamiento o colonia', 'Neighborhood')} choices={choices(options?.neighborhoods)} value={filters.neighborhood} onSelect={value => update('neighborhood', value)} />
    <FilterPicker label={tr('Código postal', 'Postal code')} choices={choices(options?.postal_codes)} value={filters.postal_code} onSelect={value => update('postal_code', value)} />
    <View style={styles.recordActions}><Action compact title={tr('Filtrar', 'Apply filters')} onPress={onApply} /><Action compact secondary title={tr('Limpiar', 'Clear')} onPress={onClear} /></View>
  </Card>;
}

function RecordForm({ draft, setDraft, onSubmit }: { draft: Record<string, string>; setDraft: React.Dispatch<React.SetStateAction<Record<string, string>>>; onSubmit: () => Promise<void> }) {
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const now = new Date();
  const [year, month, day] = (draft.birth_date || '--').split('-');
  const yearNumber = Number(year);
  const monthNumber = Number(month);
  const dayCount = monthNumber ? new Date(yearNumber || 2000, monthNumber, 0).getDate() : 31;
  const change = (name: string, value: string) => {
    setDraft(current => ({ ...current, [name]: value }));
    setErrors(current => ({ ...current, [name]: '', form: '' }));
  };
  const selectBirth = (nextYear: string, nextMonth: string, nextDay: string) => {
    const maxDay = nextMonth ? new Date(Number(nextYear) || 2000, Number(nextMonth), 0).getDate() : 31;
    change('birth_date', [nextYear, nextMonth, Number(nextDay) > maxDay ? '' : nextDay].join('-'));
  };
  const choices = (values: string[]) => values.map(value => ({ id: value, label: value }));
  const required = ['first_name', 'paternal_surname', 'address', 'birth_date', 'phone', 'electoral_key'];
  async function save() {
    if (busy) return;
    const issues: Record<string, string> = {};
    for (const field of required) {
      if (!draft[field]?.trim()) issues[field] = tr('Este campo es obligatorio.', 'This field is required.');
    }
    const birth = new Date(yearNumber, monthNumber - 1, Number(day));
    const oldest = new Date(now.getFullYear() - 120, now.getMonth(), now.getDate());
    if (!year || !month || !day) issues.birth_date = tr('Selecciona año, mes y día.', 'Select a year, month, and day.');
    else if (birth < oldest || birth > now) issues.birth_date = tr('Elige una fecha válida.', 'Choose a valid date.');
    else if (new Date(yearNumber + 18, monthNumber - 1, Number(day)) > now) issues.birth_date = tr('La persona debe tener 18 años cumplidos.', 'The person must be at least 18 years old.');
    if (draft.phone?.trim() && !/^\d{10}$/.test(draft.phone)) issues.phone = tr('Escribe 10 dígitos.', 'Enter 10 digits.');
    if (draft.postal_code?.trim() && !/^\d{5}$/.test(draft.postal_code)) issues.postal_code = tr('Escribe 5 dígitos.', 'Enter 5 digits.');
    if (draft.electoral_key?.trim() && !/^[a-z0-9]{18}$/i.test(draft.electoral_key.trim())) issues.electoral_key = tr('Escribe 18 letras o números.', 'Enter 18 letters or digits.');
    setErrors(issues);
    if (Object.keys(issues).length) return;
    setBusy(true);
    try {
      await onSubmit();
    } catch (error) {
      const body = (error as { body?: Record<string, unknown> })?.body;
      for (const [name] of RECORD_FIELDS) {
        const value = body?.[name];
        if (typeof value === 'string') issues[name] = value;
        else if (Array.isArray(value)) issues[name] = value.filter(item => typeof item === 'string').join(' ');
      }
      setErrors(Object.values(issues).some(Boolean) ? issues : { form: message(error) });
    } finally { setBusy(false); }
  }
  return <Card title={tr('Nuevo registro', 'New record')} subtitle={tr('Completa los datos de la persona.', "Enter the person's information.")}>
    {RECORD_FIELDS.map(([name, labelEs, labelEn, keyboardType]) => {
      const label = name === 'birth_date' ? tr('Fecha de nacimiento', 'Date of birth') : tr(labelEs, labelEn);
      return <View key={name} style={{ gap: 4 }}>
        <Text style={styles.fieldLabel}>{label}{required.includes(name) ? ' *' : ''}</Text>
        {name === 'birth_date' ? <>
          <FilterPicker label={tr('Año', 'Year')} value={year} choices={choices(Array.from({ length: 121 }, (_, i) => String(now.getFullYear() - i)))} onSelect={value => selectBirth(value, month, day)} allowEmpty={false} emptyLabel={tr('Elegir año', 'Choose year')} />
          <FilterPicker label={tr('Mes', 'Month')} value={month} choices={Array.from({ length: 12 }, (_, i) => ({ id: String(i + 1).padStart(2, '0'), label: new Date(2000, i, 1).toLocaleDateString(currentLanguage === 'en' ? 'en-US' : 'es-MX', { month: 'long' }) }))} onSelect={value => selectBirth(year, value, day)} allowEmpty={false} emptyLabel={tr('Elegir mes', 'Choose month')} />
          <FilterPicker label={tr('Día', 'Day')} value={day} choices={choices(Array.from({ length: dayCount }, (_, i) => String(i + 1).padStart(2, '0')))} onSelect={value => selectBirth(year, month, value)} allowEmpty={false} emptyLabel={tr('Elegir día', 'Choose day')} />
        </> : <TextInput style={[styles.input, errors[name] && { borderColor: C.red }]} accessibilityLabel={label} value={draft[name] || ''} keyboardType={keyboardType} autoCapitalize={name === 'electoral_key' ? 'characters' : 'sentences'} onChangeText={value => change(name, value)} />}
        {errors[name] ? <Text accessibilityLiveRegion="polite" style={{ color: C.red, fontSize: 12 }}>{errors[name]}</Text> : null}
      </View>;
    })}
    {errors.form ? <Text style={styles.error}>{errors.form}</Text> : null}
    <Action title={busy ? tr('Guardando…', 'Saving…') : tr('Guardar registro', 'Save record')} disabled={busy} onPress={() => void save()} />
  </Card>;
}

function GoalDateField({label, value, onSelect}: {label: string; value: string; onSelect: (date: string) => void}) {
  const [month, setMonth] = useState<Date | null>(null);
  const locale = currentLanguage === 'en' ? 'en-US' : 'es-MX';
  const selected = new Date(`${value}T12:00:00`);
  const formatted = selected.toLocaleDateString(locale, {dateStyle: 'long'});
  const year = month?.getFullYear() ?? 0;
  const index = month?.getMonth() ?? 0;
  const offset = (new Date(year, index, 1).getDay() + 6) % 7;
  const days = new Date(year, index + 1, 0).getDate();
  const cells = offset + days;
  return <View style={{gap: 6}}>
    <Text style={styles.fieldLabel}>{label}</Text>
    <Action secondary title={formatted} onPress={() => setMonth(month ? null : selected)} />
    {month ? <View style={{gap: 6}}>
      <Text style={styles.rowTitle}>{month.toLocaleDateString(locale, {month: 'long', year: 'numeric'})}</Text>
      <View style={styles.recordActions}>
        <Action compact secondary title={tr('Mes anterior', 'Previous month')} onPress={() => setMonth(new Date(year, index - 1, 1))} />
        <Action compact secondary title={tr('Mes siguiente', 'Next month')} onPress={() => setMonth(new Date(year, index + 1, 1))} />
      </View>
      <View style={{flexDirection: 'row'}}>
        {Array.from({length: 7}, (_, i) => <Text key={i} style={[styles.fieldLabel, {flex: 1, textAlign: 'center'}]}>{new Date(2024, 0, i + 1).toLocaleDateString(locale, {weekday: 'short'})}</Text>)}
      </View>
      {Array.from({length: Math.ceil(cells / 7)}, (_, week) => <View key={week} style={{flexDirection: 'row'}}>
        {Array.from({length: 7}, (_, col) => {
          const day = week * 7 + col - offset + 1;
          if (day < 1 || day > days) return <View key={col} style={{flex: 1}} />;
          const date = `${year}-${String(index + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
          return <Pressable key={col} accessibilityRole="button" accessibilityState={{selected: date === value}} accessibilityLabel={new Date(year, index, day).toLocaleDateString(locale, {dateStyle: 'long'})} style={[date === value && styles.choiceSelected, {flex: 1, alignItems: 'center', justifyContent: 'center', minHeight: 40}]} onPress={() => { onSelect(date); setMonth(null); }}>
            <Text style={styles.rowTitle}>{day}</Text>
          </Pressable>;
        })}
      </View>)}
    </View> : null}
  </View>;
}

function GoalsView(props: any) {
  const goals = [...asArray(props.data?.goals?.active), ...asArray(props.data?.goals?.history)];
  const managers = props.role === 'admin' ? asArray(props.data?.managers) : [];
  const capturers = props.role === 'gestor' ? asArray(props.data?.capturers).filter((row: AnyRow) => row.kind !== 'invite') : [];
  return <><Card title={tr('Metas', 'Goals')} subtitle={tr('Avance de metas activas', 'Active goal progress')}>{goals.length ? goals.map((goal, i) => <GoalRow key={goal.id || i} goal={goal} />) : <Empty text={tr('No hay metas activas.', 'There are no active goals.')} />}</Card><Card title={tr('Crear meta', 'Create goal')} subtitle={props.role === 'admin' ? tr('Asignada a un gestor.', 'Assigned to a manager.') : tr('Para todo tu equipo o un capturador.', 'For your whole team or one capturer.')}>
    {props.role === 'admin'
      ? <FilterPicker label={tr('Gestor', 'Manager')} choices={managers.map(row => ({ id: row.id, label: row.full_name || row.email || row.id }))} value={props.managerId} onSelect={props.setManagerId} emptyLabel={tr('Selecciona un gestor', 'Select a manager')} allowEmpty={false} />
      : <FilterPicker label={tr('Alcance de la meta', 'Goal scope')} choices={capturers.map(row => ({ id: row.id, label: row.full_name || row.email || row.id }))} value={props.goalCapturerId} onSelect={props.setGoalCapturerId} emptyLabel={tr('Todo el equipo', 'Entire team')} />}
    <Text style={styles.fieldLabel}>{tr('Cantidad de registros que se deben capturar', 'Number of records to capture')}</Text>
    <TextInput style={styles.input} placeholder={tr('Ejemplo: 20', 'Example: 20')} keyboardType="number-pad" value={props.goalTarget} onChangeText={props.setGoalTarget} />
    <GoalDateField label={tr('Fecha de inicio de la meta', 'Goal start date')} value={props.goalStart} onSelect={props.setGoalStart} />
    <GoalDateField label={tr('Fecha límite de la meta', 'Goal due date')} value={props.goalEnd} onSelect={props.setGoalEnd} />
    <Action title={tr('Crear meta semanal', 'Create weekly goal')} onPress={props.onCreate} />
  </Card></>;
}

function InviteForm(props: {role:'admin'|'gestor'; inviteName:string; setInviteName:(value:string)=>void; inviteEmail:string; setInviteEmail:(value:string)=>void; onInvite:(role:'gestor'|'capturador')=>void}) {
  const admin = props.role === 'admin';
  const role: 'gestor'|'capturador' = admin ? 'gestor' : 'capturador';
  return <Card title={admin ? tr('Agregar gestor', 'Add manager') : tr('Agregar capturador', 'Add capturer')} subtitle={admin ? tr('Crea una invitación para un nuevo gestor.', 'Create an invitation for a new manager.') : tr('Crea una invitación para un nuevo capturador.', 'Create an invitation for a new capturer.')}>
    <TextInput style={styles.input} placeholder={tr('Identificador (requerido)', 'Identifier (required)')} value={props.inviteName} onChangeText={props.setInviteName} /><TextInput style={styles.input} placeholder={tr('Correo electrónico (opcional)', 'Email address (optional)')} autoCapitalize="none" keyboardType="email-address" value={props.inviteEmail} onChangeText={props.setInviteEmail} />
    <Action title={admin ? tr('Crear invitación de gestor', 'Create manager invitation') : tr('Crear invitación de capturador', 'Create capturer invitation')} onPress={() => props.onInvite(role)} />
  </Card>;
}

function DetailView({ detail, role, records, recordsPage, recordsTotal, recordsLoading, recordMutationBusy, editingRecord, recordEditDraft, setRecordEditDraft, onBack, onToggle, onDelete, onRecordsPage, onEditRecord, onCancelRecordEdit, onSaveRecordEdit, onDeleteRecord }: { detail: AnyRow; role: Profile['role']; records: AnyRow[]; recordsPage: number; recordsTotal: number; recordsLoading: boolean; recordMutationBusy: boolean; editingRecord: AnyRow | null; recordEditDraft: Record<string, string>; setRecordEditDraft: React.Dispatch<React.SetStateAction<Record<string, string>>>; onBack: () => void; onToggle: (row: AnyRow, role: 'gestor' | 'capturador') => void; onDelete: (row: AnyRow, role: 'gestor' | 'capturador') => void; onRecordsPage: (page: number) => void; onEditRecord: (row: AnyRow) => void; onCancelRecordEdit: () => void; onSaveRecordEdit: () => void; onDeleteRecord: (row: AnyRow) => void }) {
  const manager = detail.manager || detail;
  const capturer = detail.capturer || detail.profile || detail;
  const isManager = role === 'admin' && Boolean(detail.manager || detail.total_capturadores !== undefined);
  if (isManager) return <><Action title={tr('Volver a la lista', 'Back to list')} secondary onPress={onBack} /><View style={styles.stats}><Stat label={tr('Capturadores', 'Capturers')} value={detail.total_capturadores || 0} /><Stat label={tr('Registros', 'Records')} value={detail.total_records || 0} /><Stat label={tr('Metas activas', 'Active goals')} value={detail.active_goals || 0} /></View><Card title={tr('Perfil', 'Profile')}><Info label={tr('Nombre', 'Name')} value={manager.full_name} /><Info label={tr('Correo', 'Email')} value={manager.email} /><Info label={tr('Estado', 'Status')} value={manager.is_active === false ? tr('Inactivo', 'Inactive') : tr('Activo', 'Active')} /><Action title={manager.is_active === false ? tr('Activar gestor', 'Activate manager') : tr('Desactivar gestor', 'Deactivate manager')} secondary onPress={() => onToggle(manager, 'gestor')} /><Action title={tr('Borrar gestor permanentemente', 'Permanently delete manager')} danger onPress={() => onDelete(manager, 'gestor')} /></Card><Card title={tr('Metas activas', 'Active goals')}>{asArray(detail.active_goals_list).length ? asArray(detail.active_goals_list).map((goal, i) => <GoalRow key={goal.id || i} goal={goal} />) : <Empty text={tr('Sin metas activas.', 'No active goals.')} />}</Card><Card title={tr('Capturadores con más registros', 'Capturers with the most records')}><Rankings rows={asArray(detail.ranking)} /></Card><Card title={tr('Zonas principales', 'Top areas')}><Rankings rows={asArray(detail.top_zones).map((r: AnyRow) => ({ full_name: r.zone, total_records: r.total }))} /></Card></>;
  return <><Action title={tr('Volver a la lista', 'Back to list')} secondary onPress={onBack} /><View style={styles.stats}><Stat label={tr('Registros', 'Records')} value={detail.total_records || capturer.total_records || recordsTotal || 0} /><Stat label={tr('Hoy', 'Today')} value={capturer.records_today || 0} /><Stat label={tr('Esta semana', 'This week')} value={capturer.records_week || 0} /></View><Card title={tr('Perfil', 'Profile')}><Info label={tr('Nombre', 'Name')} value={capturer.full_name || capturer.placeholder_name} /><Info label={tr('Correo', 'Email')} value={capturer.email} /><Info label={tr('Estado', 'Status')} value={capturer.is_active === false ? tr('Inactivo', 'Inactive') : tr('Activo', 'Active')} /><Action title={capturer.is_active === false ? tr('Activar capturador', 'Activate capturer') : tr('Desactivar capturador', 'Deactivate capturer')} secondary onPress={() => onToggle(capturer, 'capturador')} /><Action title={tr('Borrar capturador permanentemente', 'Permanently delete capturer')} danger onPress={() => onDelete(capturer, 'capturador')} /></Card>{detail.current_goal ? <Card title={tr('Meta actual', 'Current goal')}><GoalRow goal={detail.current_goal} /></Card> : null}{editingRecord ? <RecordEditForm draft={recordEditDraft} setDraft={setRecordEditDraft} busy={recordMutationBusy} onSave={onSaveRecordEdit} onCancel={onCancelRecordEdit} /> : null}<RecordsList rows={records} total={recordsTotal} page={recordsPage} loading={recordsLoading} busy={recordMutationBusy} onPage={onRecordsPage} onEdit={onEditRecord} onDelete={onDeleteRecord} /></>;
}

function GoalRow({ goal }: { goal: AnyRow }) {
  const target = Number(goal.target_count || 0); const current = Number(goal.current_count || goal.progress?.current_count || goal.progress?.total_records || 0); const pct = target ? Math.min(100, Math.round(current / target * 100)) : 0;
  const period = goal.period_type === 'weekly' ? tr('Semanal', 'Weekly') : goal.period_type || tr('Periodo', 'Period');
  return <View style={styles.goalRow}><View style={styles.recordTop}><Text style={styles.rowTitle}>{goal.capturer?.full_name || goal.manager?.full_name || (goal.capturer_id ? tr('Meta individual', 'Individual goal') : tr('Meta de equipo', 'Team goal'))}</Text><Text style={styles.rowMeta}>{period}</Text></View><Text style={styles.rowSub}>{current} {tr('de', 'of')} {target} {tr('registros', 'records')} · {goal.starts_on || ''} {tr('a', 'to')} {goal.ends_on || ''}</Text><View style={styles.progress}><View style={[styles.progressFill, { width: `${pct}%` }]} /></View><Text style={styles.rowMeta}>{pct}% {tr('completado', 'complete')}</Text></View>;
}

function Rankings({ rows }: { rows: AnyRow[] }) {
  return rows.length ? <>{rows.slice(0, 6).map((row, i) => <View key={row.id || i} style={styles.rankRow}><Text style={styles.rankNumber}>{i + 1}</Text><Text style={styles.rowTitle}>{row.full_name || row.zone || tr('Equipo', 'Team')}</Text><Text style={styles.rankValue}>{row.total_records ?? row.total ?? 0}</Text></View>)}</> : <Empty text={tr('Todavía no hay actividad.', 'There is no activity yet.')} />;
}

function InviteRow({ row, onResend, onGenerateLink }: { row: AnyRow; onResend?: () => void; onGenerateLink?: () => void }) { return <View style={styles.recordRow}><View style={styles.personRow}><View style={[styles.avatar, styles.avatarPending]}><Text style={styles.avatarText}>…</Text></View><View style={styles.rowMain}><Text style={styles.rowTitle} numberOfLines={1}>{row.placeholder_name || tr('Invitación pendiente', 'Pending invitation')}</Text><Text style={styles.rowSub} numberOfLines={1}>{row.email || tr('Sin correo: comparte el enlace', 'No email: share the link')}</Text><Text style={styles.rowMeta}>{row.status_label || tr('Invitación pendiente', 'Pending invitation')}</Text></View></View>{onResend || onGenerateLink ? <View style={styles.inviteActions}>{onResend && row.email ? <Action compact title={tr('Reenviar correo', 'Resend email')} onPress={onResend} /> : null}{onGenerateLink ? <Action compact title={tr('Generar enlace', 'Generate link')} secondary onPress={onGenerateLink} /> : null}</View> : null}</View>; }
function ChoiceList({ rows, value, onSelect, placeholder }: { rows: AnyRow[]; value: string; onSelect: (id: string) => void; placeholder: string }) { return <View style={{ gap: 7 }}>{rows.length ? rows.map(row => <Choice key={row.id} label={row.full_name || row.email || tr('Perfil', 'Profile')} selected={value === row.id} onPress={() => onSelect(row.id)} />) : <Empty text={placeholder} />}</View>; }
function Choice({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) { return <Pressable onPress={onPress} style={[styles.choice, selected && styles.choiceSelected]}><Text style={[styles.choiceText, selected && styles.choiceTextSelected]}>{selected ? '✓  ' : '○  '}{label}</Text></Pressable>; }
function Card({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) { return <View style={styles.card}><Text style={styles.cardTitle}>{title}</Text>{subtitle ? <Text style={styles.cardSubtitle}>{subtitle}</Text> : null}<View style={styles.cardBody}>{children}</View></View>; }
function Action({ title, onPress, secondary = false, danger = false, disabled = false, compact = false }: { title: string; onPress: () => void; secondary?: boolean; danger?: boolean; disabled?: boolean; compact?: boolean }) { return <Pressable disabled={disabled} onPress={onPress} style={[styles.action, compact && styles.actionCompact, secondary && styles.actionSecondary, danger && styles.actionDanger, disabled && { opacity: .5 }]}><Text style={[styles.actionText, compact && styles.actionTextCompact, secondary && styles.actionSecondaryText, danger && styles.actionDangerText]}>{title}</Text></Pressable>; }
function Stat({ label, value }: { label: string; value: string | number }) { return <View style={styles.stat}><Text style={styles.statValue}>{value}</Text><Text style={styles.statLabel}>{label}</Text></View>; }
function Info({ label, value }: { label: string; value?: string | number }) { return <View style={styles.infoRow}><Text style={styles.infoLabel}>{label}</Text><Text style={styles.infoValue}>{value || '—'}</Text></View>; }
function Empty({ text }: { text: string }) { return <Text style={styles.empty}>{text}</Text>; }
function unwrap(result: any): any { return result && typeof result === 'object' && 'data' in result ? result.data : result; }
function asArray(value: any): AnyRow[] { return Array.isArray(value) ? value : []; }
function queryString(values: Record<string, string | number>) { return Object.entries(values).filter(([, value]) => value !== '' && value !== null && value !== undefined).map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`).join('&'); }
function initials(value?: string) { return (value || 'GC').split(/\s+/).slice(0, 2).map(part => part[0] || '').join('').toUpperCase(); }
function roleLabel(role: 'gestor'|'capturador') { return role === 'gestor' ? tr('Gestor', 'Manager') : tr('Capturador', 'Capturer'); }
function inviteRecipient(name: string | undefined, email: string | undefined, role: 'gestor'|'capturador') { const identity = name?.trim() || roleLabel(role); return email?.trim() ? `${identity} (${email.trim()})` : `${identity} (${tr('sin correo', 'no email')})`; }
function formatDate(value?: string) { if (!value) return tr('Fecha no disponible', 'Date unavailable'); const date = new Date(value); return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString(currentLanguage === 'en' ? 'en-US' : 'es-MX'); }
function sectionLabel(section: Section) {
  const labels: Record<Section, [string, string]> = {
    Inicio: ['Inicio', 'Home'], Captura: ['Captura', 'Capture'], Registros: ['Registros', 'Records'], Gestores: ['Gestores', 'Managers'],
    Capturadores: ['Capturadores', 'Capturers'], Equipo: ['Equipo', 'Team'], Metas: ['Metas', 'Goals'], Configuración: ['Configuración', 'Settings']
  };
  return tr(...labels[section]);
}
function subtitleFor(section: Section, role: Profile['role']) { if (section === 'Inicio') return role === 'admin' ? tr('Resumen de la organización', 'Organization overview') : role === 'gestor' ? tr('Resumen de tu equipo', 'Your team overview') : tr('Lista para capturar', 'Ready to capture'); if (section === 'Registros') return tr('Consulta la actividad registrada', 'Review recorded activity'); if (section === 'Metas') return tr('Objetivos y avance de captura', 'Capture goals and progress'); if (section === 'Equipo' || section === 'Capturadores') return tr('Personas e invitaciones', 'People and invitations'); if (section === 'Gestores') return tr('Administración de gestores', 'Manager administration'); if (section === 'Configuración') return tr('Personaliza tu experiencia', 'Customize your experience'); return tr('Captura de datos', 'Data capture'); }
function message(error: unknown) { return error instanceof Error ? error.message : tr('No se pudo conectar con la API.', 'Could not connect to the API.'); }

type Palette = {
  mode: 'light' | 'dark'; blue: string; blue2: string; accent: string; blueSoft: string; ink: string; muted: string; placeholder: string;
  line: string; rowLine: string; bg: string; surface: string; surfaceAlt: string; white: string; header: string; green: string; red: string;
  successBg: string; successLine: string; dangerBg: string; dangerLine: string; pendingBg: string; progressBg: string; selectedLine: string; headerMuted: string;
};
const LIGHT_COLORS: Palette = {
  mode: 'light' as const, blue: '#123f8c', blue2: '#1f5ca8', accent: '#1f5ca8', blueSoft: '#eef5fc', ink: '#1f2937', muted: '#64748b',
  placeholder: '#7b8798', line: '#d8e1ec', rowLine: '#edf1f6', bg: '#f4f7fb', surface: '#ffffff', surfaceAlt: '#f4f7fb', white: '#ffffff',
  header: '#123f8c', green: '#32815b', red: '#a94444', successBg: '#eaf6ef', successLine: '#c7e8d3', dangerBg: '#fff0f0', dangerLine: '#f0caca',
  pendingBg: '#fff6df', progressBg: '#e7edf5', selectedLine: '#c6d8ed', headerMuted: '#dceaff'
};
const DARK_COLORS: Palette = {
  mode: 'dark', blue: '#4f83dc', blue2: '#86aff4', accent: '#9bc0ff', blueSoft: '#172b49', ink: '#f3f6fb', muted: '#adbbcd',
  placeholder: '#8493a8', line: '#344357', rowLine: '#2b394b', bg: '#0d1520', surface: '#182333', surfaceAlt: '#111b28', white: '#ffffff',
  header: '#0c2748', green: '#73d2a0', red: '#ff9a9a', successBg: '#153225', successLine: '#285a40', dangerBg: '#3a1d24', dangerLine: '#71333f',
  pendingBg: '#3a311d', progressBg: '#2b394b', selectedLine: '#456d9f', headerMuted: '#c8dcf8'
};
let C: Palette = LIGHT_COLORS;
const createStyles = (C: Palette) => StyleSheet.create({
  page: { flex: 1, backgroundColor: C.bg }, center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, backgroundColor: C.bg },
  login: { flex: 1, justifyContent: 'center', padding: 22, backgroundColor: C.header }, loginBox: { backgroundColor: C.surface, padding: 22, borderRadius: 20, borderWidth: 1, borderColor: C.line, gap: 14 }, brand: { color: C.white, fontSize: 19, fontWeight: '800' }, loginBrand: { color: C.accent, fontSize: 23, fontWeight: '800' }, subtitle: { color: C.muted, fontSize: 14 },
  header: { backgroundColor: C.header, paddingHorizontal: 18, paddingTop: 48, paddingBottom: 14 }, headerRow: { flexDirection: 'row', alignItems: 'center', gap: 11 }, brandMark: { width: 42, height: 42, backgroundColor: C.white, borderRadius: 12, alignItems: 'center', justifyContent: 'center' }, brandMarkText: { color: C.header, fontWeight: '900' }, headerText: { flex: 1 }, headerUser: { color: C.headerMuted, fontSize: 12, marginTop: 3 }, logout: { paddingVertical: 9, paddingHorizontal: 12, borderRadius: 9, backgroundColor: '#ffffff20' }, logoutText: { color: C.white, fontWeight: '700' }, rolePill: { alignSelf: 'flex-start', overflow: 'hidden', marginTop: 13, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 99, backgroundColor: C.white, color: C.header, fontWeight: '700', fontSize: 12 },
  menuToggle: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 10, backgroundColor: '#ffffff20', borderWidth: 1, borderColor: '#ffffff50' }, hamburgerLines: { gap: 5 }, hamburgerLine: { width: 21, height: 2, borderRadius: 2, backgroundColor: C.white }, drawerOverlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 50, elevation: 50, flexDirection: 'row', justifyContent: 'flex-end' }, drawerBackdrop: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: '#000' }, drawerPanel: { height: '100%', paddingTop: 48, paddingBottom: 12, backgroundColor: C.blue, borderTopLeftRadius: 18, borderBottomLeftRadius: 18, elevation: 16, shadowColor: '#000', shadowOpacity: 0.24, shadowRadius: 16, shadowOffset: { width: -5, height: 0 } }, drawerHeader: { minHeight: 58, paddingHorizontal: 20, paddingBottom: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderBottomColor: '#ffffff38', borderBottomWidth: 1 }, drawerTitle: { color: C.white, fontSize: 21, fontWeight: '800' }, drawerClose: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center', borderRadius: 10, backgroundColor: '#ffffff20' }, drawerCloseText: { color: C.white, fontSize: 30, lineHeight: 34 }, drawerScroll: { flex: 1 }, drawerItems: { paddingHorizontal: 12, paddingTop: 12, paddingBottom: 12, gap: 4 }, drawerItem: { minHeight: 48, justifyContent: 'center', paddingHorizontal: 16, borderRadius: 10 }, drawerItemActive: { backgroundColor: '#ffffff2b' }, drawerItemText: { color: C.white, fontSize: 15, fontWeight: '700' }, drawerFooter: { paddingHorizontal: 14, paddingTop: 12, borderTopColor: '#ffffff38', borderTopWidth: 1 }, drawerExitButton: { minHeight: 48, justifyContent: 'center', alignItems: 'center', borderRadius: 10, backgroundColor: '#0d3474', borderWidth: 1, borderColor: '#ffffff45' }, drawerExitText: { color: C.white, fontSize: 15, fontWeight: '800' },
  nav: { flexGrow: 0, flexShrink: 0, backgroundColor: C.surface, borderBottomColor: C.line, borderBottomWidth: 1 }, navContent: { paddingHorizontal: 12, paddingVertical: 9, gap: 8, alignItems: 'center' }, navItem: { flexShrink: 0, minWidth: 70, minHeight: 40, paddingHorizontal: 13, paddingVertical: 9, alignItems: 'center', justifyContent: 'center', borderRadius: 9, backgroundColor: C.surfaceAlt }, navActive: { backgroundColor: C.blue }, navText: { flexShrink: 0, color: C.muted, fontWeight: '700', fontSize: 13 }, navTextActive: { color: C.white },
  content: { paddingHorizontal: 16, paddingTop: 17, paddingBottom: 40, gap: 14 }, pageTitle: { marginBottom: 2, gap: 4 }, heading: { color: C.ink, fontWeight: '800', fontSize: 24 }, muted: { color: C.muted, fontSize: 13 }, card: { backgroundColor: C.surface, borderRadius: 15, borderWidth: 1, borderColor: C.line, padding: 16, gap: 7 }, cardTitle: { color: C.ink, fontSize: 17, fontWeight: '800' }, cardSubtitle: { color: C.muted, fontSize: 12, lineHeight: 18 }, cardBody: { gap: 11, marginTop: 6 },
  stats: { flexDirection: 'row', gap: 8 }, stat: { flex: 1, minHeight: 79, backgroundColor: C.surface, borderColor: C.line, borderWidth: 1, borderRadius: 13, padding: 12, justifyContent: 'center' }, statValue: { color: C.accent, fontSize: 21, fontWeight: '800' }, statLabel: { color: C.muted, fontSize: 11, marginTop: 3 },
  personRow: { flexDirection: 'row', alignItems: 'center', gap: 11, paddingVertical: 8, borderBottomColor: C.rowLine, borderBottomWidth: 1 }, avatar: { width: 40, height: 40, borderRadius: 13, backgroundColor: C.blueSoft, alignItems: 'center', justifyContent: 'center' }, avatarImage:{width:42,height:42,borderRadius:21}, avatarPending: { backgroundColor: C.pendingBg }, avatarText: { color: C.accent, fontWeight: '800' }, rowMain: { flex: 1, minWidth: 0 }, rowTitle: { color: C.ink, fontWeight: '700', fontSize: 14 }, rowSub: { color: C.muted, fontSize: 12, marginTop: 3 }, rowMeta: { color: C.muted, fontSize: 11, marginTop: 4 }, chevron: { color: C.accent, fontSize: 25, paddingHorizontal: 4 }, heartButton: { width: 34, height: 34, alignItems: 'center', justifyContent: 'center', borderRadius: 17 }, heartText: { color: C.muted, fontSize: 25, lineHeight: 28 }, heartTextActive: { color: '#e5484d' },
  recordRow: { paddingVertical: 11, borderBottomColor: C.rowLine, borderBottomWidth: 1, gap: 3 }, recordTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 }, recordTitle: { flex: 1 }, recordStatusActions: { flexDirection: 'row', alignItems: 'center', gap: 4 }, status: { color: C.green, fontSize: 10, fontWeight: '800', backgroundColor: C.successBg, paddingVertical: 4, paddingHorizontal: 8, borderRadius: 99 }, statusOff: { color: C.red, backgroundColor: C.dangerBg }, goalRow: { paddingVertical: 10, borderBottomColor: C.rowLine, borderBottomWidth: 1, gap: 7 }, progress: { height: 7, borderRadius: 99, backgroundColor: C.progressBg, overflow: 'hidden' }, progressFill: { height: '100%', backgroundColor: C.blue2, borderRadius: 99 }, rankRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 8, gap: 10 }, rankNumber: { width: 25, height: 25, textAlign: 'center', textAlignVertical: 'center', color: C.accent, backgroundColor: C.blueSoft, borderRadius: 8, overflow: 'hidden', fontWeight: '800' }, rankValue: { marginLeft: 'auto', color: C.accent, fontWeight: '800' },
  input: { backgroundColor: C.surfaceAlt, paddingHorizontal: 13, paddingVertical: 12, borderRadius: 10, borderColor: C.line, borderWidth: 1, color: C.ink, minHeight: 46 }, fieldLabel: { color: C.muted, fontWeight: '700', fontSize: 12 }, choice: { padding: 11, borderRadius: 9, backgroundColor: C.surfaceAlt, borderWidth: 1, borderColor: C.line }, choiceSelected: { backgroundColor: C.blueSoft, borderColor: C.selectedLine }, choiceText: { color: C.ink, fontSize: 13, fontWeight: '600' }, choiceTextSelected: { color: C.accent, fontWeight: '800' }, action: { minHeight: 45, borderRadius: 10, backgroundColor: C.blue, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 11, marginTop: 3 }, actionCompact: { flex: 1, minHeight: 38, marginTop: 0, paddingHorizontal: 8, paddingVertical: 8 }, actionText: { color: C.white, fontWeight: '800', textAlign: 'center' }, actionTextCompact: { fontSize: 12 }, actionSecondary: { backgroundColor: C.blueSoft, borderColor: C.selectedLine, borderWidth: 1 }, actionSecondaryText: { color: C.accent }, actionDanger: { backgroundColor: C.dangerBg, borderWidth: 1, borderColor: C.dangerLine }, actionDangerText: { color: C.red }, inviteActions: { flexDirection: 'row', gap: 8, paddingTop: 7 }, recordActions: { flexDirection: 'row', gap: 8, paddingTop: 8 }, pagination: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, paddingTop: 10 }, pageButton: { flex: 1, minHeight: 38, alignItems: 'center', justifyContent: 'center', borderRadius: 9, borderWidth: 1, borderColor: C.selectedLine, backgroundColor: C.blueSoft, paddingHorizontal: 8 }, pageButtonDisabled: { opacity: 0.42 }, pageButtonText: { color: C.accent, fontWeight: '800', fontSize: 12 }, pageSummary: { color: C.muted, fontWeight: '700', fontSize: 11, textAlign: 'center' }, filterPair: { flexDirection: 'row', gap: 8 }, filterField: { flex: 1, gap: 5 }, linkBox: { backgroundColor: C.blueSoft, borderRadius: 10, borderWidth: 1, borderColor: C.selectedLine, padding: 12, gap: 7 }, link: { color: C.accent, lineHeight: 20 }, error: { color: C.red, backgroundColor: C.dangerBg, borderColor: C.dangerLine, borderWidth: 1, padding: 11, borderRadius: 10, overflow: 'hidden' }, notice: { color: C.green, backgroundColor: C.successBg, borderColor: C.successLine, borderWidth: 1, padding: 11, borderRadius: 10, overflow: 'hidden' }, empty: { color: C.muted, fontSize: 13, paddingVertical: 8 }, infoRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 12, paddingVertical: 6, borderBottomColor: C.rowLine, borderBottomWidth: 1 }, infoLabel: { color: C.muted, fontSize: 12 }, infoValue: { color: C.ink, fontSize: 12, fontWeight: '700', flexShrink: 1, textAlign: 'right' }
});
const STYLE_CACHE = { light: createStyles(LIGHT_COLORS), dark: createStyles(DARK_COLORS) };
let styles = STYLE_CACHE.light;
