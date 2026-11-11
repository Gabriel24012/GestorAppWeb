import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Animated, Clipboard, Image, Pressable, ScrollView, StyleSheet, Text as NativeText, TextInput, useWindowDimensions, View } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { StatusBar } from 'expo-status-bar';
import { ApiEnvelope, Profile, api, currentUser, getPreferences, login, logout, savePreferences, uploadProfileImage } from './src/api';

type Section = 'Inicio' | 'Captura' | 'Registros' | 'Gestores' | 'Capturadores' | 'Equipo' | 'Metas' | 'Configuración';
type AnyRow = Record<string, any>;
const RECORD_FIELDS: Array<[string, string, 'default' | 'numeric' | 'phone-pad']> = [
  ['first_name', 'Nombre(s)', 'default'], ['paternal_surname', 'Apellido paterno', 'default'], ['maternal_surname', 'Apellido materno (opcional)', 'default'],
  ['address', 'Domicilio', 'default'], ['exterior_number', 'Número exterior', 'default'], ['neighborhood', 'Colonia', 'default'],
  ['district', 'Municipio o distrito', 'default'], ['postal_code', 'Código postal', 'numeric'], ['birth_date', 'Fecha de nacimiento (AAAA-MM-DD)', 'default'],
  ['phone', 'Teléfono', 'phone-pad'], ['electoral_key', 'Clave electoral', 'default'], ['observations', 'Observaciones (opcional)', 'default']
];
const today = () => new Date().toISOString().slice(0, 10);
let fontScale = 1;
function Text(props: React.ComponentProps<typeof NativeText>) {
  const style = StyleSheet.flatten(props.style);
  return <NativeText {...props} style={style?.fontSize ? {...style, fontSize: style.fontSize * fontScale} : props.style} />;
}

export default function App() {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
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
  const [preferences, setPreferences] = useState<{theme:'light'|'dark';font_size:'small'|'normal'|'large';language:'es'|'en'}>({theme:'light',font_size:'normal',language:'es'});
  fontScale = preferences.font_size === 'small' ? 0.88 : preferences.font_size === 'large' ? 1.15 : 1;

  function changeSection(next: Section) {
    setSection(next);
    setMenuOpen(false);
    setDetail(null);
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
    <View style={styles.drawerHeader}><Text style={styles.drawerTitle}>Menú</Text><Pressable accessibilityRole="button" accessibilityLabel="Cerrar menú" onPress={() => setMenuOpen(false)} style={styles.drawerClose}><Text style={styles.drawerCloseText}>×</Text></Pressable></View>
    <ScrollView style={styles.drawerScroll} contentContainerStyle={styles.drawerItems}>
      {tabs.map(item => <Pressable key={item} accessibilityRole="button" onPress={() => changeSection(item)} style={[styles.drawerItem, section === item && styles.drawerItemActive]}><Text style={styles.drawerItemText}>{item}</Text></Pressable>)}
    </ScrollView>
    <View style={styles.drawerFooter}><Pressable accessibilityRole="button" onPress={() => { setMenuOpen(false); void logout().then(() => { setProfile(null); setPayload(null); }); }} style={styles.drawerExitButton}><Text style={styles.drawerExitText}>Salir</Text></Pressable></View>
  </>;

  async function loadSection() {
    if (!profile) return;
    if (section === 'Configuración') { setPayload({}); setLoading(false); return; }
    setLoading(true); setError(''); setDetail(null);
    try {
      let path = '/dashboard/admin';
      if (section === 'Inicio') path = profile.role === 'admin' ? '/admin/managers' : profile.role === 'gestor' ? '/dashboard/gestor' : '/capture-context';
      else if (section === 'Captura') path = '/capture-context';
      else if (section === 'Gestores') path = '/gestores?role=gestor';
      else if (section === 'Capturadores') path = profile.role === 'gestor' ? '/capturadores' : '/capturadores';
      else if (section === 'Equipo') path = '/capturadores';
      else if (section === 'Registros') path = profile.role === 'admin' ? '/admin/records?limit=30' : profile.role === 'gestor' ? '/manager/records?limit=30' : '/records?limit=30';
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
    try { await api('/auth/resend-verification', { method:'POST', body:JSON.stringify({email:email.trim()}) }, false); Alert.alert('Revisa tu correo', 'Si la cuenta requiere verificación, enviamos un enlace.'); }
    catch (e) { setError(message(e)); }
  }

  async function selectProfileImage() {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) { Alert.alert('Permiso necesario', 'Permite acceso a tus fotos para elegir una imagen de perfil.'); return; }
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes:['images'], allowsEditing:true, aspect:[1,1], quality:0.85 });
    if (!result.canceled) { try { const asset = result.assets[0]; const uri = await uploadProfileImage(asset.uri, asset.mimeType, asset.fileName); setProfile(p=>p?{...p,profile_image:uri}:p); } catch(e) { setError(message(e)); } }
  }

  async function updatePreference<K extends keyof typeof preferences>(key: K, value: typeof preferences[K]) {
    const next = {...preferences, [key]:value}; setPreferences(next); try { await savePreferences(next); } catch(e) { setError(message(e)); }
  }

  async function removeProfileImage() {
    try { await api('/profile/image', {method:'DELETE'}); setProfile(p=>p?{...p,profile_image:''}:p); }
    catch(e) { setError(message(e)); }
  }

  async function submitRecord() {
    setError('');
    try {
      const body = { ...recordDraft, electoral_key: recordDraft.electoral_key?.trim().toUpperCase(), capture_session_id: captureSessionId || null, section_code: 'GENERAL' };
      await api('/records', { method: 'POST', body: JSON.stringify(body) });
      setRecordDraft({}); Alert.alert('Registro guardado', 'El registro se agregó correctamente.');
      changeSection('Registros');
    } catch (e) { setError(message(e)); }
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
      setInviteLinkDescription(`Invitación nueva para ${owner}.`);
      setNotice(result?.data?.email_sent === false ? result?.data?.warning || 'El correo no se envió. Copia y comparte el enlace.' : `Invitación enviada a ${owner}.`);
      setInviteName(''); setInviteEmail(''); await loadSection();
    } catch (e) { setError(message(e)); }
  }

  async function resendMemberInvite(id: string, role: 'gestor' | 'capturador') {
    setError(''); setNotice('');
    try {
      const path = role === 'gestor' ? `/admin/manager-invites/${id}/resend-email` : `/capturadores/${id}/resend-email`;
      const result = await api<any>(path, {method:'POST',body:JSON.stringify({})});
      if (result?.data?.email_sent) setNotice(`Correo de invitación reenviado a ${result?.data?.recipient_email || 'la dirección registrada'}.`);
      else setError(result?.data?.warning || 'Resend no pudo enviar el correo. Revisa la configuración de correo de la API.');
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
      setInviteLinkDescription(`Enlace nuevo para ${owner}. El enlace anterior dejó de ser válido.`);
      const copied = await copyToClipboard(link);
      setNotice(copied ? `Enlace nuevo para ${owner}; se copió al portapapeles. El anterior dejó de ser válido.` : `Se generó un enlace nuevo para ${owner}, pero no se pudo copiar. El anterior dejó de ser válido.`);
      if (!copied) setError('Mantén pulsado el enlace para seleccionarlo y copiarlo.');
    } catch(e) { setError(message(e)); }
  }

  async function copyInviteLink() {
    setError(''); setNotice('');
    const copied = await copyToClipboard(inviteLink);
    if (copied) setNotice(`Enlace de ${inviteLinkOwner || 'la invitación'} copiado al portapapeles.`);
    else setError('No se pudo copiar el enlace. Mantén pulsado el texto del enlace para seleccionarlo y copiarlo.');
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
      await api(path, { method: 'POST', body: JSON.stringify({ ...(admin ? { manager_id: targetId } : { capturer_id: targetId || null }), period_type: 'weekly', target_count: Number(goalTarget), starts_on: goalStart, ends_on: goalEnd }) });
      Alert.alert('Meta creada', 'La meta quedó registrada.'); await loadSection();
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
      setDetailTitle(name);
    } catch (e) { setError(message(e)); }
    finally { setLoading(false); }
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
    Alert.alert(`Borrar ${role}`, `¿Borrar permanentemente a ${name}? La acción no se puede deshacer. Si tiene miembros o registros asociados, el servidor impedirá el borrado y explicará por qué.`, [
      { text: 'Cancelar', style: 'cancel' },
      { text: 'Borrar', style: 'destructive', onPress: () => { void deleteProfile(row, role); } }
    ]);
  }

  async function deleteProfile(row: AnyRow, role: 'gestor' | 'capturador') {
    setError('');
    try {
      await api(`/${role === 'gestor' ? 'gestores' : 'capturadores'}/${row.id}`, { method: 'DELETE' });
      setDetail(null);
      await loadSection();
      Alert.alert('Cuenta eliminada', `${role === 'gestor' ? 'El gestor' : 'El capturador'} se eliminó permanentemente.`);
    } catch (e) { setError(message(e)); }
  }

  if (loading && !profile) return <View style={styles.center}><ActivityIndicator size="large" color={C.blue} /><Text style={styles.muted}>Cargando sesión…</Text></View>;
  if (!profile) return <View style={styles.login}><StatusBar style="light" /><View style={styles.loginBox}><Text style={styles.loginBrand}>Gestión de Captura</Text><Text style={styles.subtitle}>Inicia sesión con tu cuenta</Text><TextInput style={styles.input} placeholder="Correo" autoCapitalize="none" keyboardType="email-address" value={email} onChangeText={setEmail} /><TextInput style={styles.input} placeholder="Contraseña" secureTextEntry value={password} onChangeText={setPassword} />{error ? <Text style={styles.error}>{error}</Text> : null}{error.includes('email_not_verified') ? <Action title="Reenviar verificación" secondary onPress={()=>void resendVerification()} /> : null}<Action title={loading ? 'Entrando…' : 'Entrar'} onPress={() => void submitLogin()} disabled={loading} /></View></View>;


  const data = unwrap(payload);
  const roleName = profile.role === 'admin' ? 'Administrador' : profile.role === 'gestor' ? 'Gestor' : 'Capturador';
  return <View style={[styles.page,{backgroundColor:preferences.theme==='dark'?'#111923':C.bg}]}><StatusBar style="light" />
    <View style={styles.header}>
      <View style={styles.headerRow}>
        {profile.profile_image ? <Image source={{uri:profile.profile_image}} style={styles.avatarImage}/> : <View style={styles.brandMark}><Text style={styles.brandMarkText}>GC</Text></View>}
        <View style={styles.headerText}><Text style={styles.brand}>Gestión de Captura</Text><Text style={styles.headerUser}>{profile.full_name}</Text></View>
        <Pressable style={styles.menuToggle} accessibilityRole="button" accessibilityLabel={menuOpen ? "Cerrar menú" : "Abrir menú"} accessibilityState={{ expanded: menuOpen }} onPress={() => setMenuOpen(open => !open)}>
          <View style={styles.hamburgerLines}><View style={styles.hamburgerLine}/><View style={styles.hamburgerLine}/><View style={styles.hamburgerLine}/></View>
        </Pressable>
      </View>
      <Text style={styles.rolePill}>{roleName}</Text>
    </View>
    <ScrollView contentContainerStyle={styles.content}>
      {section !== 'Configuración' && inviteLink && inviteLinkSection === section ? <View style={styles.linkBox}><Text style={styles.fieldLabel}>Enlace para: {inviteLinkOwner}</Text><Text selectable style={styles.link}>{inviteLink}</Text><Text style={styles.rowMeta}>{inviteLinkDescription}</Text><Action compact title="Copiar enlace" onPress={() => void copyInviteLink()} /></View> : null}
      <View style={styles.pageTitle}><Text style={styles.heading}>{detail ? detailTitle : section}</Text><Text style={styles.muted}>{detail ? 'Resumen y actividad' : subtitleFor(section, profile.role)}</Text></View>
      {error ? <Text style={styles.error}>{error}</Text> : null}
      {notice ? <Text style={styles.notice}>{notice}</Text> : null}
      {detail ? <DetailView detail={detail} role={profile.role} onBack={() => setDetail(null)} onToggle={(row, role) => void toggleProfile(row, role)} onDelete={confirmDeleteProfile} /> : loading ? <ActivityIndicator color={C.blue} style={{ marginTop: 28 }} /> : <>
        {section === 'Configuración' ? <><Card title="Correo y cuenta"><Text style={styles.rowSub}>{profile.email_verified ? 'Correo verificado' : 'Correo pendiente de verificación'}</Text>{!profile.email_verified ? <Action title="Reenviar verificación" secondary onPress={() => void resendVerification()} /> : null}</Card><Card title="Appearance / Apariencia"><Text style={styles.fieldLabel}>Theme / Tema</Text><ChoiceList rows={[{id:'light',full_name:'Light / Claro'},{id:'dark',full_name:'Dark / Oscuro'}]} value={preferences.theme} onSelect={v=>void updatePreference('theme',v as 'light'|'dark')} placeholder=""/><Text style={styles.fieldLabel}>Text size / Tamaño</Text><ChoiceList rows={['small','normal','large'].map(id=>({id,full_name:id}))} value={preferences.font_size} onSelect={v=>void updatePreference('font_size',v as 'small'|'normal'|'large')} placeholder=""/><Text style={styles.fieldLabel}>Language / Idioma</Text><ChoiceList rows={[{id:'es',full_name:'Español'},{id:'en',full_name:'English'}]} value={preferences.language} onSelect={v=>void updatePreference('language',v as 'es'|'en')} placeholder=""/></Card><Card title="Perfil"><View style={styles.personRow}>{profile.profile_image ? <Image source={{uri:profile.profile_image}} style={styles.avatarImage}/> : <View style={styles.avatar}><Text style={styles.avatarText}>{initials(profile.full_name)}</Text></View>}<Text style={styles.rowTitle}>{profile.full_name}</Text></View><Action title="Cambiar foto de perfil" onPress={()=>void selectProfileImage()}/>{profile.profile_image?<Action title="Eliminar foto" secondary onPress={()=>void removeProfileImage()}/>:null}</Card></> : null}
        {section === 'Inicio' && profile.role === 'admin' ? <AdminHome rows={asArray(data)} onOpen={openManager} /> : null}
        {section === 'Inicio' && profile.role === 'gestor' ? <ManagerHome data={data} onSection={changeSection} /> : null}
        {section === 'Inicio' && profile.role === 'capturador' ? <CapturerHome data={data} onSection={changeSection} /> : null}
        {section === 'Captura' && profile.role === 'capturador' ? <RecordForm draft={recordDraft} setDraft={setRecordDraft} onSubmit={() => void submitRecord()} /> : null}
        {section === 'Gestores' && profile.role === 'admin' ? <><ManagerList rows={asArray(data)} onOpen={openManager} onResend={id=>void resendMemberInvite(id,'gestor')} onGenerateLink={id=>void generateMemberLink(id,'gestor')} /><InviteForm role="admin" inviteName={inviteName} setInviteName={setInviteName} inviteEmail={inviteEmail} setInviteEmail={setInviteEmail} onInvite={createInvite} /></> : null}
        {section === 'Capturadores' && profile.role === 'gestor' ? <><CapturerList rows={asArray(data)} onOpen={openCapturer} onResend={id=>void resendMemberInvite(id,'capturador')} onGenerateLink={id=>void generateMemberLink(id,'capturador')} /><InviteForm role="gestor" inviteName={inviteName} setInviteName={setInviteName} inviteEmail={inviteEmail} setInviteEmail={setInviteEmail} onInvite={createInvite} /></> : null}
        {section === 'Equipo' ? profile.role === 'admin' ? <AdminTeam managers={asArray(data?.managers)} capturers={asArray(data?.capturers)} onOpenManager={openManager} onOpenCapturer={openCapturer} onResendManager={id=>void resendMemberInvite(id,'gestor')} onGenerateManagerLink={id=>void generateMemberLink(id,'gestor')} onResendCapturer={id=>void resendMemberInvite(id,'capturador')} onGenerateCapturerLink={id=>void generateMemberLink(id,'capturador')} /> : <CapturerList rows={asArray(data)} onOpen={openCapturer} onResend={id=>void resendMemberInvite(id,'capturador')} onGenerateLink={id=>void generateMemberLink(id,'capturador')} /> : null}
        {section === 'Registros' ? profile.role === 'capturador' ? <><RecordForm draft={recordDraft} setDraft={setRecordDraft} onSubmit={() => void submitRecord()} /><RecordsList rows={asArray(data)} total={payload?.meta?.total} /></> : <RecordsList rows={asArray(data)} total={payload?.meta?.total} /> : null}
        {section === 'Metas' ? <GoalsView data={data} role={profile.role} managers={asArray((payload as any)?.managers)} capturers={asArray((payload as any)?.capturers)} managerId={managerId} setManagerId={setManagerId} goalCapturerId={goalCapturerId} setGoalCapturerId={setGoalCapturerId} goalTarget={goalTarget} setGoalTarget={setGoalTarget} goalStart={goalStart} setGoalStart={setGoalStart} goalEnd={goalEnd} setGoalEnd={setGoalEnd} onCreate={() => void createGoal()} /> : null}
      </>}
    </ScrollView>
    {drawerMounted ? <View style={styles.drawerOverlay} pointerEvents={menuOpen ? 'auto' : 'none'}>
      <Animated.View style={[styles.drawerBackdrop, { opacity: menuProgress.interpolate({ inputRange: [0, 1], outputRange: [0, 0.48] }) }]}>
        <Pressable accessibilityRole="button" accessibilityLabel="Cerrar menú" onPress={() => setMenuOpen(false)} style={StyleSheet.absoluteFill} />
      </Animated.View>
      <Animated.View style={[styles.drawerPanel, { width: drawerWidth, transform: [{ translateX: menuProgress.interpolate({ inputRange: [0, 1], outputRange: [drawerWidth, 0] }) }] }]}>{menuContent}</Animated.View>
    </View> : null}
  </View>;
}

function AdminHome({ rows, onOpen }: { rows: AnyRow[]; onOpen: (id: string, name: string) => void }) {
  const managers = rows.filter(row => row.kind !== 'invite');
  const totalCapturers = managers.reduce((sum, row) => sum + Number(row.total_capturadores || 0), 0);
  const totalRecords = managers.reduce((sum, row) => sum + Number(row.total_records || 0), 0);
  return <><View style={styles.stats}><Stat label="Gestores" value={managers.length} /><Stat label="Capturadores" value={totalCapturers} /><Stat label="Registros" value={totalRecords} /></View><Card title="Tus gestores" subtitle="Abre un perfil para consultar su equipo y resultados.">{managers.length ? managers.map(row => <ManagerRow key={row.id} row={row} onPress={() => onOpen(row.id, row.full_name)} />) : <Empty text="Todavía no hay gestores registrados." />}</Card></>;
}

function ManagerHome({ data, onSection }: { data: AnyRow; onSection: (section: Section) => void }) {
  return <><View style={styles.stats}><Stat label="Registros hoy" value={data?.records_today || 0} /><Stat label="Esta semana" value={data?.records_week || 0} /><Stat label="Capturadores" value={data?.total_capturadores || 0} /></View><Card title="Metas activas">{asArray(data?.active_goals_list || data?.goals).length ? asArray(data?.active_goals_list || data?.goals).map((goal, i) => <GoalRow key={goal.id || i} goal={goal} />) : <Empty text="No hay metas activas." />}</Card><Card title="Actividad del equipo"><Rankings rows={asArray(data?.ranking)} /><Action title="Ver capturadores" onPress={() => onSection('Capturadores')} /></Card><Card title="Zonas con más registros"><Rankings rows={asArray(data?.top_zones).map((r: AnyRow) => ({ full_name: r.zone, total_records: r.total }))} /></Card></>;
}

function CapturerHome({ data, onSection }: { data: AnyRow; onSection: (section: Section) => void }) {
  return <><Card title="Tu jornada" subtitle="Los registros se guardarán en la sesión de captura activa."><Info label="Gestor" value={data?.leadership_name || 'Sin asignar'} /><Info label="Sección" value={data?.section_code || 'General'} /><Info label="Sesión" value={data?.capture_session_id ? 'Activa' : 'No disponible'} /><Action title="Comenzar captura" onPress={() => onSection('Captura')} /></Card><Card title="Accesos rápidos"><Action title="Ver mis registros" onPress={() => onSection('Registros')} /></Card></>;
}

function ManagerList({ rows, onOpen, onResend, onGenerateLink }: { rows: AnyRow[]; onOpen: (id: string, name: string) => void; onResend?: (id: string) => void; onGenerateLink?: (id: string) => void }) {
  return <Card title="Gestores" subtitle={`${rows.length} perfiles`}>
    {rows.length ? rows.map(row => row.kind === 'invite' ? <InviteRow key={row.id} row={row} onResend={onResend ? () => onResend(row.id) : undefined} onGenerateLink={onGenerateLink ? () => onGenerateLink(row.id) : undefined} /> : <ManagerRow key={row.id} row={row} onPress={() => onOpen(row.id, row.full_name)} />) : <Empty text="No hay gestores disponibles." />}
  </Card>;
}

function ManagerRow({ row, onPress }: { row: AnyRow; onPress: () => void }) {
  return <Pressable onPress={onPress} style={styles.personRow}>{row.profile_image?<Image source={{uri:row.profile_image}} style={styles.avatarImage}/>:<View style={styles.avatar}><Text style={styles.avatarText}>{initials(row.full_name)}</Text></View>}<View style={styles.rowMain}><Text style={styles.rowTitle} numberOfLines={1}>{row.full_name || 'Gestor'}</Text><Text style={styles.rowSub} numberOfLines={1}>{row.email || 'Sin correo'} · {row.is_active === false ? 'Inactivo' : 'Activo'}</Text><Text style={styles.rowMeta} numberOfLines={1}>{row.total_capturadores || 0} capturadores · {row.total_records || 0} registros · {row.email_verified ? 'Verificado' : 'Pendiente'}</Text></View><Text style={styles.chevron}>›</Text></Pressable>;
}

function CapturerList({ rows, onOpen, onResend, onGenerateLink }: { rows: AnyRow[]; onOpen: (id: string, name: string) => void; onResend?: (id: string) => void; onGenerateLink?: (id: string) => void }) {
  return <Card title="Equipo de captura" subtitle={`${rows.length} integrantes`}>
    {rows.length ? rows.map((row, i) => row.kind === 'invite' ? <InviteRow key={row.id || i} row={row} onResend={onResend ? () => onResend(row.id) : undefined} onGenerateLink={onGenerateLink ? () => onGenerateLink(row.id) : undefined} /> : <Pressable key={row.id || i} style={styles.personRow} onPress={() => onOpen(row.id, row.full_name || 'Capturador')}>{row.profile_image?<Image source={{uri:row.profile_image}} style={styles.avatarImage}/>:<View style={styles.avatar}><Text style={styles.avatarText}>{initials(row.placeholder_name || row.full_name)}</Text></View>}<View style={styles.rowMain}><Text style={styles.rowTitle} numberOfLines={1}>{row.full_name || row.placeholder_name || 'Capturador'}</Text><Text style={styles.rowSub} numberOfLines={1}>{row.email || 'Sin correo'} · {row.status_label || (row.is_active === false ? 'Inactivo' : 'Activo')}</Text><Text style={styles.rowMeta} numberOfLines={1}>{row.total_records ?? 0} registros · Hoy {row.records_today ?? 0} · {row.email_verified ? 'Verificado' : 'Pendiente'}</Text></View><Text style={styles.chevron}>›</Text></Pressable>) : <Empty text="Todavía no hay capturadores en el equipo." />}
  </Card>;
}

function AdminTeam({ managers, capturers, onOpenManager, onOpenCapturer, onResendManager, onGenerateManagerLink, onResendCapturer, onGenerateCapturerLink }: { managers: AnyRow[]; capturers: AnyRow[]; onOpenManager: (id: string, name: string) => void; onOpenCapturer: (id: string, name: string) => void; onResendManager: (id: string) => void; onGenerateManagerLink: (id: string) => void; onResendCapturer: (id: string) => void; onGenerateCapturerLink: (id: string) => void }) {
  return <><ManagerList rows={managers} onOpen={onOpenManager} onResend={onResendManager} onGenerateLink={onGenerateManagerLink} /><CapturerList rows={capturers} onOpen={onOpenCapturer} onResend={onResendCapturer} onGenerateLink={onGenerateCapturerLink} /></>;
}

function RecordsList({ rows, total }: { rows: AnyRow[]; total?: number }) {
  return <Card title="Registros recientes" subtitle={`${total ?? rows.length} en total`}>
    {rows.length ? rows.map((row, i) => <View key={row.id || i} style={styles.recordRow}><View style={styles.recordTop}><Text style={styles.rowTitle}>{[row.first_name, row.paternal_surname, row.maternal_surname].filter(Boolean).join(' ') || 'Registro'}</Text><Text style={[styles.status, row.status === 'voided' && styles.statusOff]}>{row.status === 'voided' ? 'Anulado' : 'Activo'}</Text></View><Text style={styles.rowSub}>{row.phone || 'Sin teléfono'} · {row.district || 'Sin municipio'}</Text><Text style={styles.rowMeta}>{row.neighborhood || 'Sin colonia'} · {formatDate(row.created_at)}</Text></View>) : <Empty text="Aún no hay registros para mostrar." />}
  </Card>;
}

function RecordForm({ draft, setDraft, onSubmit }: { draft: Record<string, string>; setDraft: React.Dispatch<React.SetStateAction<Record<string, string>>>; onSubmit: () => void }) {
  return <Card title="Nuevo registro" subtitle="Completa los datos de la persona.">
    {RECORD_FIELDS.map(([name, label, keyboardType]) => <TextInput key={name} style={styles.input} placeholder={label} value={draft[name] || ''} keyboardType={keyboardType} autoCapitalize={name === 'electoral_key' ? 'characters' : 'sentences'} onChangeText={value => setDraft(current => ({ ...current, [name]: value }))} />)}
    <Action title="Guardar registro" onPress={onSubmit} />
  </Card>;
}

function GoalsView(props: any) {
  const goals = [...asArray(props.data?.goals?.active), ...asArray(props.data?.goals?.history)];
  const managers = props.role === 'admin' ? asArray(props.data?.managers) : [];
  const capturers = props.role === 'gestor' ? asArray(props.data?.capturers).filter((row: AnyRow) => row.kind !== 'invite') : [];
  return <><Card title="Metas" subtitle="Avance de metas activas">{goals.length ? goals.map((goal, i) => <GoalRow key={goal.id || i} goal={goal} />) : <Empty text="No hay metas activas." />}</Card><Card title="Crear meta" subtitle={props.role === 'admin' ? 'Asignada a un gestor.' : 'Para todo tu equipo o un capturador.'}>
    {props.role === 'admin' ? <><Text style={styles.fieldLabel}>Gestor</Text><ChoiceList rows={managers} value={props.managerId} onSelect={props.setManagerId} placeholder="Selecciona gestor" /></> : <><Text style={styles.fieldLabel}>Alcance</Text><Action title="Todo el equipo" secondary onPress={() => props.setGoalCapturerId('')} />{capturers.map((row: AnyRow) => <Choice key={row.id} label={row.full_name} selected={props.goalCapturerId === row.id} onPress={() => props.setGoalCapturerId(row.id)} />)}</>}
    <TextInput style={styles.input} placeholder="Objetivo de registros" keyboardType="numeric" value={props.goalTarget} onChangeText={props.setGoalTarget} /><TextInput style={styles.input} placeholder="Inicio (AAAA-MM-DD)" value={props.goalStart} onChangeText={props.setGoalStart} /><TextInput style={styles.input} placeholder="Fin (AAAA-MM-DD)" value={props.goalEnd} onChangeText={props.setGoalEnd} /><Action title="Crear meta semanal" onPress={props.onCreate} />
  </Card></>;
}

function InviteForm(props: {role:'admin'|'gestor'; inviteName:string; setInviteName:(value:string)=>void; inviteEmail:string; setInviteEmail:(value:string)=>void; onInvite:(role:'gestor'|'capturador')=>void}) {
  const admin = props.role === 'admin';
  const role: 'gestor'|'capturador' = admin ? 'gestor' : 'capturador';
  return <Card title={admin ? 'Agregar gestor' : 'Agregar capturador'} subtitle={admin ? 'Crea una invitación para un nuevo gestor.' : 'Crea una invitación para un nuevo capturador.'}>
    <TextInput style={styles.input} placeholder="Identificador (requerido)" value={props.inviteName} onChangeText={props.setInviteName} /><TextInput style={styles.input} placeholder="Correo electrónico (opcional)" autoCapitalize="none" keyboardType="email-address" value={props.inviteEmail} onChangeText={props.setInviteEmail} />
    <Action title={admin ? 'Crear invitación de gestor' : 'Crear invitación de capturador'} onPress={() => props.onInvite(role)} />
  </Card>;
}

function DetailView({ detail, role, onBack, onToggle, onDelete }: { detail: AnyRow; role: Profile['role']; onBack: () => void; onToggle: (row: AnyRow, role: 'gestor' | 'capturador') => void; onDelete: (row: AnyRow, role: 'gestor' | 'capturador') => void }) {
  const manager = detail.manager || detail;
  const capturer = detail.capturer || detail.profile || detail;
  const isManager = role === 'admin' && Boolean(detail.manager || detail.total_capturadores !== undefined);
  if (isManager) return <><Action title="Volver a la lista" secondary onPress={onBack} /><View style={styles.stats}><Stat label="Capturadores" value={detail.total_capturadores || 0} /><Stat label="Registros" value={detail.total_records || 0} /><Stat label="Metas activas" value={detail.active_goals || 0} /></View><Card title="Perfil"><Info label="Nombre" value={manager.full_name} /><Info label="Correo" value={manager.email} /><Info label="Estado" value={manager.is_active === false ? 'Inactivo' : 'Activo'} /><Action title={manager.is_active === false ? 'Activar gestor' : 'Desactivar gestor'} secondary onPress={() => onToggle(manager, 'gestor')} /><Action title="Borrar gestor permanentemente" danger onPress={() => onDelete(manager, 'gestor')} /></Card><Card title="Metas activas">{asArray(detail.active_goals_list).length ? asArray(detail.active_goals_list).map((goal, i) => <GoalRow key={goal.id || i} goal={goal} />) : <Empty text="Sin metas activas." />}</Card><Card title="Capturadores con más registros"><Rankings rows={asArray(detail.ranking)} /></Card><Card title="Zonas principales"><Rankings rows={asArray(detail.top_zones).map((r: AnyRow) => ({ full_name: r.zone, total_records: r.total }))} /></Card></>;
  return <><Action title="Volver a la lista" secondary onPress={onBack} /><View style={styles.stats}><Stat label="Registros" value={detail.total_records || capturer.total_records || 0} /><Stat label="Hoy" value={capturer.records_today || 0} /><Stat label="Esta semana" value={capturer.records_week || 0} /></View><Card title="Perfil"><Info label="Nombre" value={capturer.full_name || capturer.placeholder_name} /><Info label="Correo" value={capturer.email} /><Info label="Estado" value={capturer.is_active === false ? 'Inactivo' : 'Activo'} /><Action title={capturer.is_active === false ? 'Activar capturador' : 'Desactivar capturador'} secondary onPress={() => onToggle(capturer, 'capturador')} /><Action title="Borrar capturador permanentemente" danger onPress={() => onDelete(capturer, 'capturador')} /></Card>{detail.current_goal ? <Card title="Meta actual"><GoalRow goal={detail.current_goal} /></Card> : null}<Card title="Registros recientes"><RecordsList rows={asArray(detail.recent_records)} /></Card></>;
}

function GoalRow({ goal }: { goal: AnyRow }) {
  const target = Number(goal.target_count || 0); const current = Number(goal.current_count || goal.progress?.current_count || goal.progress?.total_records || 0); const pct = target ? Math.min(100, Math.round(current / target * 100)) : 0;
  return <View style={styles.goalRow}><View style={styles.recordTop}><Text style={styles.rowTitle}>{goal.capturer?.full_name || goal.manager?.full_name || (goal.capturer_id ? 'Meta individual' : 'Meta de equipo')}</Text><Text style={styles.rowMeta}>{goal.period_type || 'Periodo'}</Text></View><Text style={styles.rowSub}>{current} de {target} registros · {goal.starts_on || ''} a {goal.ends_on || ''}</Text><View style={styles.progress}><View style={[styles.progressFill, { width: `${pct}%` }]} /></View><Text style={styles.rowMeta}>{pct}% completado</Text></View>;
}

function Rankings({ rows }: { rows: AnyRow[] }) {
  return rows.length ? <>{rows.slice(0, 6).map((row, i) => <View key={row.id || i} style={styles.rankRow}><Text style={styles.rankNumber}>{i + 1}</Text><Text style={styles.rowTitle}>{row.full_name || row.zone || 'Equipo'}</Text><Text style={styles.rankValue}>{row.total_records ?? row.total ?? 0}</Text></View>)}</> : <Empty text="Todavía no hay actividad." />;
}

function InviteRow({ row, onResend, onGenerateLink }: { row: AnyRow; onResend?: () => void; onGenerateLink?: () => void }) { return <View style={styles.recordRow}><View style={styles.personRow}><View style={[styles.avatar, styles.avatarPending]}><Text style={styles.avatarText}>…</Text></View><View style={styles.rowMain}><Text style={styles.rowTitle} numberOfLines={1}>{row.placeholder_name || 'Invitación pendiente'}</Text><Text style={styles.rowSub} numberOfLines={1}>{row.email || 'Sin correo: comparte el enlace'}</Text><Text style={styles.rowMeta}>{row.status_label || 'Invitación pendiente'}</Text></View></View>{onResend || onGenerateLink ? <View style={styles.inviteActions}>{onResend && row.email ? <Action compact title="Reenviar correo" onPress={onResend} /> : null}{onGenerateLink ? <Action compact title="Generar link" secondary onPress={onGenerateLink} /> : null}</View> : null}</View>; }
function ChoiceList({ rows, value, onSelect, placeholder }: { rows: AnyRow[]; value: string; onSelect: (id: string) => void; placeholder: string }) { return <View style={{ gap: 7 }}>{rows.length ? rows.map(row => <Choice key={row.id} label={row.full_name || row.email || 'Perfil'} selected={value === row.id} onPress={() => onSelect(row.id)} />) : <Empty text={placeholder} />}</View>; }
function Choice({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) { return <Pressable onPress={onPress} style={[styles.choice, selected && styles.choiceSelected]}><Text style={[styles.choiceText, selected && styles.choiceTextSelected]}>{selected ? '✓  ' : '○  '}{label}</Text></Pressable>; }
function Card({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) { return <View style={styles.card}><Text style={styles.cardTitle}>{title}</Text>{subtitle ? <Text style={styles.cardSubtitle}>{subtitle}</Text> : null}<View style={styles.cardBody}>{children}</View></View>; }
function Action({ title, onPress, secondary = false, danger = false, disabled = false, compact = false }: { title: string; onPress: () => void; secondary?: boolean; danger?: boolean; disabled?: boolean; compact?: boolean }) { return <Pressable disabled={disabled} onPress={onPress} style={[styles.action, compact && styles.actionCompact, secondary && styles.actionSecondary, danger && styles.actionDanger, disabled && { opacity: .5 }]}><Text style={[styles.actionText, compact && styles.actionTextCompact, secondary && styles.actionSecondaryText, danger && styles.actionDangerText]}>{title}</Text></Pressable>; }
function Stat({ label, value }: { label: string; value: string | number }) { return <View style={styles.stat}><Text style={styles.statValue}>{value}</Text><Text style={styles.statLabel}>{label}</Text></View>; }
function Info({ label, value }: { label: string; value?: string | number }) { return <View style={styles.infoRow}><Text style={styles.infoLabel}>{label}</Text><Text style={styles.infoValue}>{value || '—'}</Text></View>; }
function Empty({ text }: { text: string }) { return <Text style={styles.empty}>{text}</Text>; }
function unwrap(result: any): any { return result && typeof result === 'object' && 'data' in result ? result.data : result; }
function asArray(value: any): AnyRow[] { return Array.isArray(value) ? value : []; }
function initials(value?: string) { return (value || 'GC').split(/\s+/).slice(0, 2).map(part => part[0] || '').join('').toUpperCase(); }
function roleLabel(role: 'gestor'|'capturador') { return role === 'gestor' ? 'Gestor' : 'Capturador'; }
function inviteRecipient(name: string | undefined, email: string | undefined, role: 'gestor'|'capturador') { const identity = name?.trim() || roleLabel(role); return email?.trim() ? `${identity} (${email.trim()})` : `${identity} (sin correo)`; }
function formatDate(value?: string) { if (!value) return 'Fecha no disponible'; const date = new Date(value); return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString(); }
function subtitleFor(section: Section, role: Profile['role']) { if (section === 'Inicio') return role === 'admin' ? 'Resumen de la organización' : role === 'gestor' ? 'Resumen de tu equipo' : 'Lista para capturar'; if (section === 'Registros') return 'Consulta la actividad registrada'; if (section === 'Metas') return 'Objetivos y avance de captura'; if (section === 'Equipo' || section === 'Capturadores') return 'Personas e invitaciones'; if (section === 'Gestores') return 'Administración de gestores'; return 'Captura de datos'; }
function message(error: unknown) { return error instanceof Error ? error.message : 'No se pudo conectar con la API.'; }

const C = { blue: '#123f8c', blue2: '#1f5ca8', blueSoft: '#eef5fc', ink: '#1f2937', muted: '#64748b', line: '#d8e1ec', bg: '#f4f7fb', white: '#fff', green: '#32815b', red: '#b85b5b' };
const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: C.bg }, center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, backgroundColor: C.bg },
  login: { flex: 1, justifyContent: 'center', padding: 22, backgroundColor: C.blue }, loginBox: { backgroundColor: C.bg, padding: 22, borderRadius: 20, gap: 14 }, brand: { color: C.white, fontSize: 19, fontWeight: '800' }, loginBrand: { color: C.blue, fontSize: 23, fontWeight: '800' }, subtitle: { color: C.muted, fontSize: 14 },
  header: { backgroundColor: C.blue, paddingHorizontal: 18, paddingTop: 48, paddingBottom: 14 }, headerRow: { flexDirection: 'row', alignItems: 'center', gap: 11 }, brandMark: { width: 42, height: 42, backgroundColor: C.white, borderRadius: 12, alignItems: 'center', justifyContent: 'center' }, brandMarkText: { color: C.blue, fontWeight: '900' }, headerText: { flex: 1 }, headerUser: { color: '#dceaff', fontSize: 12, marginTop: 3 }, logout: { paddingVertical: 9, paddingHorizontal: 12, borderRadius: 9, backgroundColor: '#ffffff20' }, logoutText: { color: C.white, fontWeight: '700' }, rolePill: { alignSelf: 'flex-start', overflow: 'hidden', marginTop: 13, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 99, backgroundColor: '#ffffff', color: C.blue, fontWeight: '700', fontSize: 12 },
  menuToggle: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 10, backgroundColor: '#ffffff20', borderWidth: 1, borderColor: '#ffffff50' }, hamburgerLines: { gap: 5 }, hamburgerLine: { width: 21, height: 2, borderRadius: 2, backgroundColor: C.white }, drawerOverlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 50, elevation: 50, flexDirection: 'row', justifyContent: 'flex-end' }, drawerBackdrop: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: '#000' }, drawerPanel: { height: '100%', paddingTop: 48, paddingBottom: 12, backgroundColor: C.blue, borderTopLeftRadius: 18, borderBottomLeftRadius: 18, elevation: 16, shadowColor: '#000', shadowOpacity: 0.24, shadowRadius: 16, shadowOffset: { width: -5, height: 0 } }, drawerHeader: { minHeight: 58, paddingHorizontal: 20, paddingBottom: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderBottomColor: '#ffffff38', borderBottomWidth: 1 }, drawerTitle: { color: C.white, fontSize: 21, fontWeight: '800' }, drawerClose: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center', borderRadius: 10, backgroundColor: '#ffffff20' }, drawerCloseText: { color: C.white, fontSize: 30, lineHeight: 34 }, drawerScroll: { flex: 1 }, drawerItems: { paddingHorizontal: 12, paddingTop: 12, paddingBottom: 12, gap: 4 }, drawerItem: { minHeight: 48, justifyContent: 'center', paddingHorizontal: 16, borderRadius: 10 }, drawerItemActive: { backgroundColor: '#ffffff2b' }, drawerItemText: { color: C.white, fontSize: 15, fontWeight: '700' }, drawerFooter: { paddingHorizontal: 14, paddingTop: 12, borderTopColor: '#ffffff38', borderTopWidth: 1 }, drawerExitButton: { minHeight: 48, justifyContent: 'center', alignItems: 'center', borderRadius: 10, backgroundColor: '#0d3474', borderWidth: 1, borderColor: '#ffffff45' }, drawerExitText: { color: C.white, fontSize: 15, fontWeight: '800' },
  nav: { flexGrow: 0, flexShrink: 0, backgroundColor: C.white, borderBottomColor: C.line, borderBottomWidth: 1 }, navContent: { paddingHorizontal: 12, paddingVertical: 9, gap: 8, alignItems: 'center' }, navItem: { flexShrink: 0, minWidth: 70, minHeight: 40, paddingHorizontal: 13, paddingVertical: 9, alignItems: 'center', justifyContent: 'center', borderRadius: 9, backgroundColor: C.bg }, navActive: { backgroundColor: C.blue }, navText: { flexShrink: 0, color: C.muted, fontWeight: '700', fontSize: 13 }, navTextActive: { color: C.white },
  content: { paddingHorizontal: 16, paddingTop: 17, paddingBottom: 40, gap: 14 }, pageTitle: { marginBottom: 2, gap: 4 }, heading: { color: C.ink, fontWeight: '800', fontSize: 24 }, muted: { color: C.muted, fontSize: 13 }, card: { backgroundColor: C.white, borderRadius: 15, borderWidth: 1, borderColor: C.line, padding: 16, gap: 7 }, cardTitle: { color: C.ink, fontSize: 17, fontWeight: '800' }, cardSubtitle: { color: C.muted, fontSize: 12, lineHeight: 18 }, cardBody: { gap: 11, marginTop: 6 },
  stats: { flexDirection: 'row', gap: 8 }, stat: { flex: 1, minHeight: 79, backgroundColor: C.white, borderColor: C.line, borderWidth: 1, borderRadius: 13, padding: 12, justifyContent: 'center' }, statValue: { color: C.blue, fontSize: 21, fontWeight: '800' }, statLabel: { color: C.muted, fontSize: 11, marginTop: 3 },
  personRow: { flexDirection: 'row', alignItems: 'center', gap: 11, paddingVertical: 8, borderBottomColor: '#edf1f6', borderBottomWidth: 1 }, avatar: { width: 40, height: 40, borderRadius: 13, backgroundColor: C.blueSoft, alignItems: 'center', justifyContent: 'center' }, avatarImage:{width:42,height:42,borderRadius:21}, avatarPending: { backgroundColor: '#fff6df' }, avatarText: { color: C.blue, fontWeight: '800' }, rowMain: { flex: 1, minWidth: 0 }, rowTitle: { color: C.ink, fontWeight: '700', fontSize: 14 }, rowSub: { color: C.muted, fontSize: 12, marginTop: 3 }, rowMeta: { color: C.muted, fontSize: 11, marginTop: 4 }, chevron: { color: C.blue, fontSize: 25, paddingHorizontal: 4 },
  recordRow: { paddingVertical: 11, borderBottomColor: '#edf1f6', borderBottomWidth: 1, gap: 3 }, recordTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 }, status: { color: C.green, fontSize: 10, fontWeight: '800', backgroundColor: '#e7f4ed', paddingVertical: 4, paddingHorizontal: 8, borderRadius: 99 }, statusOff: { color: C.red, backgroundColor: '#fff0f0' }, goalRow: { paddingVertical: 10, borderBottomColor: '#edf1f6', borderBottomWidth: 1, gap: 7 }, progress: { height: 7, borderRadius: 99, backgroundColor: '#e7edf5', overflow: 'hidden' }, progressFill: { height: '100%', backgroundColor: C.blue2, borderRadius: 99 }, rankRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 8, gap: 10 }, rankNumber: { width: 25, height: 25, textAlign: 'center', textAlignVertical: 'center', color: C.blue, backgroundColor: C.blueSoft, borderRadius: 8, overflow: 'hidden', fontWeight: '800' }, rankValue: { marginLeft: 'auto', color: C.blue, fontWeight: '800' },
  input: { backgroundColor: C.white, paddingHorizontal: 13, paddingVertical: 12, borderRadius: 10, borderColor: C.line, borderWidth: 1, color: C.ink, minHeight: 46 }, fieldLabel: { color: C.muted, fontWeight: '700', fontSize: 12 }, choice: { padding: 11, borderRadius: 9, backgroundColor: C.bg, borderWidth: 1, borderColor: C.line }, choiceSelected: { backgroundColor: C.blueSoft, borderColor: C.blue2 }, choiceText: { color: C.ink, fontSize: 13, fontWeight: '600' }, choiceTextSelected: { color: C.blue, fontWeight: '800' }, action: { minHeight: 45, borderRadius: 10, backgroundColor: C.blue, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 11, marginTop: 3 }, actionCompact: { flex: 1, minHeight: 38, marginTop: 0, paddingHorizontal: 8, paddingVertical: 8 }, actionText: { color: C.white, fontWeight: '800', textAlign: 'center' }, actionTextCompact: { fontSize: 12 }, actionSecondary: { backgroundColor: C.blueSoft, borderColor: '#c6d8ed', borderWidth: 1 }, actionSecondaryText: { color: C.blue }, actionDanger: { backgroundColor: '#fff0f0', borderWidth: 1, borderColor: '#f0caca' }, actionDangerText: { color: C.red }, inviteActions: { flexDirection: 'row', gap: 8, paddingTop: 7 }, linkBox: { backgroundColor: C.blueSoft, borderRadius: 10, padding: 12, gap: 7 }, link: { color: C.blue, lineHeight: 20 }, error: { color: '#8f2222', backgroundColor: '#fff0f0', borderColor: '#f0caca', borderWidth: 1, padding: 11, borderRadius: 10, overflow: 'hidden' }, notice: { color: '#205d3b', backgroundColor: '#eaf6ef', borderColor: '#c7e8d3', borderWidth: 1, padding: 11, borderRadius: 10, overflow: 'hidden' }, empty: { color: C.muted, fontSize: 13, paddingVertical: 8 }, infoRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 12, paddingVertical: 6, borderBottomColor: '#edf1f6', borderBottomWidth: 1 }, infoLabel: { color: C.muted, fontSize: 12 }, infoValue: { color: C.ink, fontSize: 12, fontWeight: '700', flexShrink: 1, textAlign: 'right' }
});
