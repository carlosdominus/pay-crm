import React, { useState, useEffect, useMemo, useDeferredValue, useRef } from 'react';
import Papa from 'papaparse';
import { 
  Settings,
  Save,
  Database,
  RefreshCw, 
  Search, 
  ExternalLink, 
  Copy, 
  CheckCircle2,
  Clock,
  Trash2,
  ChevronRight,
  X,
  History,
  Package,
  Calendar,
  Filter,
  ChevronDown,
  Phone,
  Edit,
  Key,
  LayoutDashboard,
  AtSign,
  Plus,
  TrendingUp,
  DollarSign,
  Users,
  UserX,
  UserCheck,
  AlertCircle,
  Hash,
  ShoppingBag,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { parse, getTime, startOfDay, endOfDay, startOfWeek, startOfMonth, isWithinInterval, format, differenceInHours, differenceInDays } from 'date-fns';
import { ptBR } from 'date-fns/locale';

import { 
  auth, 
  db, 
  googleProvider, 
  signInWithPopup, 
  signOut, 
  onAuthStateChanged, 
  collection, 
  doc, 
  setDoc, 
  deleteDoc, 
  onSnapshot, 
  query, 
  orderBy,
  where,
  getDocFromServer,
  User,
  handleFirestoreError,
  OperationType
} from './firebase';

import { Lead, Client, STATUS_THEMES, ManualSale, WhatsAppAccount, WorkspaceInvite, WorkspaceKey, ClientTag, InteractionLog } from './types';
import { cn } from './lib/utils';
import { generatePersonalizedMessage } from './services/gemini';
import { 
  BarChart, 
  Bar, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer, 
  LineChart, 
  Line,
  AreaChart,
  Area,
  PieChart,
  Pie,
  Cell
} from 'recharts';

const SHEET_CSV_URL = "https://docs.google.com/spreadsheets/d/1_rVWRk6_Knv5WLRONjC-wh_vFH6SymnTTFxbwqn-ehY/export?format=csv";

const MANUAL_PRODUCTS = [
  { name: "Vpower - 1 Pote", fixedCommission: 46.54 },
  { name: "Vpower - 3 Potes", fixedCommission: 94.05 },
  { name: "Vpower - 6 Potes", fixedCommission: 141.55 },
  { name: "Protocolo Força Natural", type: 'front', commissionRate: 0.5 },
  { name: "Diagnóstico Personalizado", type: 'upsell', commissionRate: 0.5 },
  { name: "Bônus Especial", type: 'upsell', commissionRate: 0.5 },
  { name: "Tônico do Cavalo", type: 'upsell', commissionRate: 0.5 },
  { name: "Outros", type: 'upsell', commissionRate: 0.5 },
];

const PAYMENT_METHODS: Record<string, string> = {
  "0": "Nenhum",
  "1": "Cartão de Crédito",
  "2": "Boleto Bancário",
  "3": "PayPal",
  "4": "Cartão Recorrente",
  "5": "Gratuito",
  "6": "Cartão Upsell",
  "7": "Pix"
};

const cleanPhone = (phone: string): string => {
  if (!phone) return "";
  // Remove all non-digits
  let cleaned = phone.replace(/\D/g, '');
  
  // Handle double DDI (5555...)
  // If it starts with 5555 and is long, it's likely a double DDI
  if (cleaned.startsWith('5555') && cleaned.length >= 14) {
    cleaned = cleaned.substring(2);
  }
  
  // Ensure it starts with 55 if it's a Brazilian number (10 or 11 digits without DDI)
  if (cleaned.length === 10 || cleaned.length === 11) {
    if (!cleaned.startsWith('55')) {
      cleaned = '55' + cleaned;
    } else {
      // If it starts with 55 and has 11 digits, it could be DDD 55 + 9 digits (total 11)
      // or it could be DDI 55 + DDD + 7 digits (total 11 - invalid).
      // In Brazil, if it's 11 digits and starts with 55, it's almost always DDD 55 + 9 digits.
      // So we add 55 DDI.
      cleaned = '55' + cleaned;
    }
  }
  
  return cleaned;
};

const isValidPhone = (phone: string): boolean => {
  const cleaned = cleanPhone(phone);
  // Brazilian numbers with DDI: 55 + DDD (2) + Number (8 or 9)
  // Mobile: 55 + DDD + 9XXXXXXXX (13 digits)
  // Landline or Mobile without the extra 9: 55 + DDD + XXXXXXXX (12 digits)
  if (cleaned.length === 13) {
    return cleaned.startsWith('55') && cleaned[4] === '9';
  }
  if (cleaned.length === 12) {
    return cleaned.startsWith('55');
  }
  return false;
};

export default function App() {
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const deferredSearchTerm = useDeferredValue(searchTerm);
  const [selectedClient, setSelectedClient] = useState<Client | null>(null);
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null);
  const [generatedMessage, setGeneratedMessage] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [copied, setCopied] = useState(false);
  const [filterType, setFilterType] = useState<'all' | 'today' | 'week' | 'month' | 'custom'>('all');
  const [customStartDate, setCustomStartDate] = useState<string>("");
  const [customEndDate, setCustomEndDate] = useState<string>("");
  const [showFilterMenu, setShowFilterMenu] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [activeSettingsTab, setActiveSettingsTab] = useState<'general' | 'partners'>('general');
  const [webhookUrl, setWebhookUrl] = useState(() => localStorage.getItem('crm_webhook_url') || "");
  const [sheetSyncUrl, setSheetSyncUrl] = useState(() => localStorage.getItem('crm_sheet_sync_url') || "");
  const [view, setView] = useState<'crm' | 'dashboard' | 'followup'>('crm');
  const [whatsappAccounts, setWhatsappAccounts] = useState<WhatsAppAccount[]>([]);
  const [clientExtraData, setClientExtraData] = useState<Record<string, { trackingCode?: string; assignedWhatsappId?: string; tag?: string }>>({});
  const [showWhatsappManager, setShowWhatsappManager] = useState(false);
  const [isSavingWhatsapp, setIsSavingWhatsapp] = useState(false);
  const [whatsappForm, setWhatsappForm] = useState({
    name: "",
    origin: "",
    color: "#25D366",
    phoneNumber: "",
    identifier: ""
  });

  const getClientTag = (client: Client) => {
    // 1. Manual tag from Firestore (highest priority)
    const manualTag = clientTags[client.key];
    if (manualTag) return manualTag;

    // 2. Automatic 'Vendido' detection (ONLY if they have MANUAL sales recorded)
    // This ensures that approved leads from the spreadsheet still show "Enviar Msg"
    // until a manual interaction/sale is logged.
    if (client.manualSales && client.manualSales.length > 0) return 'vendido';

    // 3. Explicit 'Lixo' status in Spreadsheet
    if (client.status === 'Lixo' || client.leads.some(l => l.status === 'Lixo')) {
      return 'lixo';
    }

    // 4. Auto-detected 'Lixo' (no phone)
    const hasValidPhone = isValidPhone(client.telefone) || client.leads.some(l => isValidPhone(l.telefone));
    if (!hasValidPhone) return 'lixo';

    return null;
  };
  
  // Auth and Workspace state
  const [user, setUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [effectiveWorkspaceId, setEffectiveWorkspaceId] = useState<string | null>(null);
  const [effectiveOwnerEmail, setEffectiveOwnerEmail] = useState<string | null>(null);
  
  // Method 1: Email Invites (legacy/fallback)
  const [myInvites, setMyInvites] = useState<WorkspaceInvite[]>([]);
  const [mySentInvites, setMySentInvites] = useState<WorkspaceInvite[]>([]);
  const [inviteEmail, setInviteEmail] = useState("");
  const [isInviting, setIsInviting] = useState(false);

  const [myOwnWorkspaceKey, setMyOwnWorkspaceKey] = useState<string | null>(null);
  const [domainAccessEnabled, setDomainAccessEnabled] = useState(false);
  const [activePartnerKey, setActivePartnerKey] = useState<string | null>(() => localStorage.getItem('crm_partner_key'));
  const [domainWorkspaceData, setDomainWorkspaceData] = useState<WorkspaceKey | null>(null);
  const [partnerWorkspaceData, setPartnerWorkspaceData] = useState<WorkspaceKey | null>(null);
  const [accessKeyInput, setAccessKeyInput] = useState("");
  const [isGeneratingKey, setIsGeneratingKey] = useState(false);
  const [isLinkingKey, setIsLinkingKey] = useState(false);
  const [keyError, setKeyError] = useState<string | null>(null);

  // 1. Auth State
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (u) => {
      setUser(u);
      if (!u) {
        setEffectiveWorkspaceId(null);
        setEffectiveOwnerEmail(null);
        setAuthReady(true);
      }
    });
    return () => unsubscribe();
  }, []);

  // 1.1 Sync my own workspace key from Firestore
  useEffect(() => {
    if (!user) return;
    const unsub = onSnapshot(doc(db, 'workspaceConfig', user.uid), (snap) => {
      if (snap.exists()) {
        const data = snap.data();
        setMyOwnWorkspaceKey(data.key);
        setDomainAccessEnabled(!!data.domainAccessEnabled);
      }
    });
    return () => unsub();
  }, [user]);

  // 1.2 Sync active partner workspace data if a key is present
  useEffect(() => {
    if (!activePartnerKey) {
      setPartnerWorkspaceData(null);
      return;
    }

    const unsub = onSnapshot(doc(db, 'workspaceKeys', activePartnerKey), (snap) => {
      if (snap.exists()) {
        const data = snap.data() as WorkspaceKey;
        setPartnerWorkspaceData(data);
      } else {
        setPartnerWorkspaceData(null);
        setActivePartnerKey(null);
        localStorage.removeItem('crm_partner_key');
      }
    });
    return () => unsub();
  }, [activePartnerKey]);

  // 2. Domain Discovery (Auto-connect teammate)
  useEffect(() => {
    if (!user || activePartnerKey) {
      setDomainWorkspaceData(null);
      return;
    }
    
    const emailDomain = user.email?.split('@')[1];
    if (!emailDomain || emailDomain === 'gmail.com' || emailDomain === 'outlook.com' || emailDomain === 'hotmail.com') return;

    const unsub = onSnapshot(doc(db, 'domainWorkspaces', emailDomain), (snap) => {
      if (snap.exists()) {
        const data = snap.data() as WorkspaceKey;
        // If it's not my own workspace, set it as domain workspace
        if (data.ownerUid !== user.uid) {
          setDomainWorkspaceData(data);
        } else {
          setDomainWorkspaceData(null);
        }
      } else {
        setDomainWorkspaceData(null);
      }
    });
    return () => unsub();
  }, [user, activePartnerKey]);

  // 3. Determine Effective Workspace
  useEffect(() => {
    if (!user) return;

    // Priority 1: Manual Access Key
    if (partnerWorkspaceData) {
      setEffectiveWorkspaceId(partnerWorkspaceData.ownerUid);
      setEffectiveOwnerEmail(partnerWorkspaceData.ownerEmail);
      setAuthReady(true);
      return;
    }

    // Priority 2: Domain Auto-Match
    if (domainWorkspaceData) {
      setEffectiveWorkspaceId(domainWorkspaceData.ownerUid);
      setEffectiveOwnerEmail(domainWorkspaceData.ownerEmail);
      setAuthReady(true);
      return;
    }

    // Priority 3: Legacy Invites
    const activeInvite = myInvites.find(i => i.status === 'accepted' || i.inviteeEmail === user.email);
    if (activeInvite) {
      setEffectiveWorkspaceId(activeInvite.ownerUid);
      setEffectiveOwnerEmail(activeInvite.ownerEmail);
    } else {
      setEffectiveWorkspaceId(user.uid);
      setEffectiveOwnerEmail(user.email);
    }
    setAuthReady(true);
  }, [user, partnerWorkspaceData, domainWorkspaceData, myInvites]);

  // 4. Logic for Domain Access & Keys
  const generateWorkspaceKey = async () => {
    if (!user) return;
    setIsGeneratingKey(true);
    try {
      const emailDomain = user.email?.split('@')[1] || "";
      const newKey = `DOM-${Math.random().toString(36).substring(2, 8).toUpperCase()}`;
      const payload: WorkspaceKey = {
        key: newKey,
        ownerUid: user.uid,
        ownerEmail: user.email!,
        ownerDomain: emailDomain,
        domainAccessEnabled: domainAccessEnabled,
        createdAt: new Date().toISOString()
      };
      
      await setDoc(doc(db, 'workspaceKeys', newKey), payload);
      await setDoc(doc(db, 'workspaceConfig', user.uid), { 
        key: newKey, 
        domainAccessEnabled, 
        ownerDomain: emailDomain 
      }, { merge: true });
      
      setMyOwnWorkspaceKey(newKey);
    } catch (e) {
      console.error("Erro ao gerar chave:", e);
      handleFirestoreError(e, OperationType.WRITE, `workspaceKeys/${user.uid}`);
    } finally {
      setIsGeneratingKey(false);
    }
  };

  const toggleDomainAccess = async (enabled: boolean) => {
    if (!user) return;
    
    let keyToUse = myOwnWorkspaceKey;
    
    // If enabling and no key exists, generate one first
    if (enabled && !keyToUse) {
      setIsGeneratingKey(true);
      try {
        const emailDomain = user.email?.split('@')[1] || "";
        const newKey = `DOM-${Math.random().toString(36).substring(2, 8).toUpperCase()}`;
        const payload: WorkspaceKey = {
          key: newKey,
          ownerUid: user.uid,
          ownerEmail: user.email!,
          ownerDomain: emailDomain,
          domainAccessEnabled: true, // We are enabling it now
          createdAt: new Date().toISOString()
        };
        
        await setDoc(doc(db, 'workspaceKeys', newKey), payload);
        await setDoc(doc(db, 'workspaceConfig', user.uid), { 
          key: newKey, 
          domainAccessEnabled: true, 
          ownerDomain: emailDomain 
        }, { merge: true });
        
        // Also add to domainWorkspaces
        if (emailDomain) {
          await setDoc(doc(db, 'domainWorkspaces', emailDomain), payload);
        }
        
        setMyOwnWorkspaceKey(newKey);
        setDomainAccessEnabled(true);
        setIsGeneratingKey(false);
        return; // Success, already toggled
      } catch (e) {
        console.error("Erro ao gerar chave automática:", e);
        handleFirestoreError(e, OperationType.WRITE, `workspaceConfig/${user.uid}`);
        setIsGeneratingKey(false);
        return;
      }
    }

    if (!keyToUse) return;

    setDomainAccessEnabled(enabled);
    const domain = user.email?.split('@')[1];
    if (!domain) return;

    try {
      if (enabled) {
        const payload: WorkspaceKey = {
          key: keyToUse,
          ownerUid: user.uid,
          ownerEmail: user.email!,
          ownerDomain: domain,
          domainAccessEnabled: true,
          createdAt: new Date().toISOString()
        };
        await setDoc(doc(db, 'domainWorkspaces', domain), payload);
      } else {
        await deleteDoc(doc(db, 'domainWorkspaces', domain));
      }
      await setDoc(doc(db, 'workspaceConfig', user.uid), { domainAccessEnabled: enabled }, { merge: true });
      
      // Sync update to the key itself too
      await setDoc(doc(db, 'workspaceKeys', keyToUse), { domainAccessEnabled: enabled }, { merge: true });
    } catch (e) {
      console.error("Erro ao alternar domain access:", e);
      handleFirestoreError(e, OperationType.WRITE, `domainWorkspaces/${domain}`);
    }
  };

  const redeemAccessKey = async () => {
    if (!accessKeyInput) return;
    setIsLinkingKey(true);
    setKeyError(null);
    try {
      const key = accessKeyInput.trim().toUpperCase();
      const snap = await getDocFromServer(doc(db, 'workspaceKeys', key));
      
      if (snap.exists()) {
        const data = snap.data() as WorkspaceKey;
        if (data.ownerUid === user?.uid) {
          setKeyError("Você não pode conectar na sua própria chave.");
          return;
        }
        setActivePartnerKey(key);
        localStorage.setItem('crm_partner_key', key);
        
        // Record partnership in Firestore for security rules
        if (user) {
          await setDoc(doc(db, 'partnerships', `${data.ownerUid}_${user.uid}`), {
            ownerUid: data.ownerUid,
            ownerEmail: data.ownerEmail,
            partnerUid: user.uid,
            partnerEmail: user.email,
            keyUsed: key,
            connectedAt: new Date().toISOString()
          });
        }

        setAccessKeyInput("");
        setPartnerWorkspaceData(data);
      } else {
        setKeyError("Chave de acesso inválida ou expirada.");
      }
    } catch (e) {
      console.error("Erro ao resgatar chave:", e);
      setKeyError("Erro ao verificar chave. Tente novamente.");
    } finally {
      setIsLinkingKey(false);
    }
  };

  const disconnectWorkspace = () => {
    setActivePartnerKey(null);
    localStorage.removeItem('crm_partner_key');
    setPartnerWorkspaceData(null);
  };

  // Listen for invites SENT by the logged-in user
  useEffect(() => {
    if (!user) return;
    const q = query(collection(db, 'invites'), where('ownerUid', '==', user.uid));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      setMySentInvites(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as WorkspaceInvite)));
    });
    return () => unsubscribe();
  }, [user]);

  const sendInvite = async () => {
    if (!user || !inviteEmail) return;
    setIsInviting(true);
    const inviteId = Math.random().toString(36).substring(2, 15);
    try {
      await setDoc(doc(db, 'invites', inviteId), {
        id: inviteId,
        ownerEmail: user.email,
        ownerUid: user.uid,
        inviteeEmail: inviteEmail.toLowerCase().trim(),
        status: 'accepted', // Auto-accepted for now to simplify
        createdAt: new Date().toISOString()
      });
      setInviteEmail("");
    } catch (e) {
      console.error("Erro ao enviar convite:", e);
    } finally {
      setIsInviting(false);
    }
  };

  const removeInvite = async (id: string) => {
    try {
      await deleteDoc(doc(db, 'invites', id));
    } catch (e) {
      console.error("Erro ao remover convite:", e);
    }
  };

  const handleLogin = async () => {
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (error: any) {
      console.error("Erro ao fazer login:", error);
    }
  };

  const handleLogout = async () => {
    try {
      await signOut(auth);
      setEffectiveWorkspaceId(null);
    } catch (error) {
      console.error("Erro ao fazer logout:", error);
    }
  };

  // Pagination state
  const [visibleCount, setVisibleCount] = useState(50);
  const tableContainerRef = useRef<HTMLDivElement>(null);
  const salesTableRef = useRef<HTMLDivElement>(null);

  // Manual Sales state
  const [manualSales, setManualSales] = useState<ManualSale[]>([]);

  useEffect(() => {
    if (!authReady || !effectiveWorkspaceId) {
      if (!user && authReady) {
        const saved = localStorage.getItem('crm_manual_sales');
        setManualSales(saved ? JSON.parse(saved) : []);
      }
      return;
    }

    const q = query(collection(db, `users/${effectiveWorkspaceId}/sales`), orderBy('timestamp', 'desc'));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const sales = snapshot.docs.map(doc => doc.data() as ManualSale);
      setManualSales(sales);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, `users/${effectiveWorkspaceId}/sales`);
    });

    return () => unsubscribe();
  }, [authReady, user, effectiveWorkspaceId]);

  const [showAddSaleModal, setShowAddSaleModal] = useState(false);
  const [editingSaleId, setEditingSaleId] = useState<string | null>(null);
  const [saleForm, setSaleForm] = useState({
    productIndex: 0,
    value: "",
    date: format(new Date(), 'yyyy-MM-dd'),
    time: format(new Date(), 'HH:mm')
  });

  // Filter states
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [tagFilter, setTagFilter] = useState<string>("all");
  const [showOnlyManualSales, setShowOnlyManualSales] = useState(false);
  const [showUtms, setShowUtms] = useState(false);

  // Hook to handle synchronization between scrolls is no longer needed as we'll use a single container
  // with native scrollbars.
  
  // Tagging state
  useEffect(() => {
    if (!authReady) return;

    if (!user) {
      const saved = localStorage.getItem('crm_client_extra_data');
      setClientExtraData(saved ? JSON.parse(saved) : {});
      return;
    }

    if (!effectiveWorkspaceId) {
      setClientExtraData({});
      return;
    }

    const unsubscribe = onSnapshot(collection(db, `users/${effectiveWorkspaceId}/clientData`), (snapshot) => {
      const pStatuses: Record<string, any> = {};
      const pCounts: Record<string, number> = {};
      const extraData: Record<string, any> = {};
      
      snapshot.docs.forEach(doc => {
        const data = doc.data();
        if (data.paymentStatus) {
          pStatuses[data.clientKey] = {
            status: data.paymentStatus,
            updatedAt: data.paymentStatusUpdatedAt
          };
        }
        if (data.potsCount) {
          pCounts[data.clientKey] = data.potsCount;
        }
        
        // Legacy tag support: if tag exists in clientData, we'll keep it in extraData
        // and we might need to sync it to clientTags state elsewhere
        extraData[data.clientKey] = data;
      });
      
      setPaymentStatuses(pStatuses);
      setPotsCounts(pCounts);
      setClientExtraData(extraData);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, `users/${effectiveWorkspaceId}/clientData`);
    });

    return () => unsubscribe();
  }, [authReady, user, effectiveWorkspaceId]);

  const addInteractionLog = async (clientKey: string, type: InteractionLog['type'], content: string) => {
    if (!user || !effectiveWorkspaceId) return;
    try {
      const logRef = doc(collection(db, `users/${effectiveWorkspaceId}/history`));
      await setDoc(logRef, {
        clientKey,
        type,
        content,
        timestamp: new Date().toISOString()
      });
    } catch (e) {
      console.error("Erro ao salvar log:", e);
    }
  };

  const updatePaymentStatus = async (clientKey: string, status: 'link_enviado' | 'pix_enviado' | 'boleto_enviado' | null) => {
    if (!user || !effectiveWorkspaceId) return;
    try {
      const docRef = doc(db, `users/${effectiveWorkspaceId}/clientData`, clientKey);
      const now = new Date().toISOString();
      await setDoc(docRef, {
        clientKey,
        paymentStatus: status,
        paymentStatusUpdatedAt: now,
        updatedAt: now
      }, { merge: true });
      
      if (status) {
        addInteractionLog(clientKey, 'payment_status_change', `Status de pagamento alterado para: ${status.replace('_', ' ')}`);
      }
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, `users/${effectiveWorkspaceId}/clientData/${clientKey}`);
    }
  };

  const updatePotsCount = async (clientKey: string, count: number) => {
    if (!user || !effectiveWorkspaceId) return;
    try {
      const docRef = doc(db, `users/${effectiveWorkspaceId}/clientData`, clientKey);
      await setDoc(docRef, {
        clientKey,
        potsCount: count,
        updatedAt: new Date().toISOString()
      }, { merge: true });
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, `users/${effectiveWorkspaceId}/clientData/${clientKey}`);
    }
  };

  useEffect(() => {
    if (!authReady) return;

    if (!user) {
      const saved = localStorage.getItem('crm_whatsapp_accounts');
      setWhatsappAccounts(saved ? JSON.parse(saved) : []);
      return;
    }

    if (!effectiveWorkspaceId) {
      setWhatsappAccounts([]);
      return;
    }

    const q = query(collection(db, `users/${effectiveWorkspaceId}/whatsappAccounts`), orderBy('createdAt', 'desc'));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const accounts = snapshot.docs.map(doc => doc.data() as WhatsAppAccount);
      setWhatsappAccounts(accounts);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, `users/${effectiveWorkspaceId}/whatsappAccounts`);
    });

    return () => unsubscribe();
  }, [authReady, user, effectiveWorkspaceId]);

  const saveWhatsappAccount = async () => {
    if (!whatsappForm.name || !whatsappForm.identifier) {
      alert("Por favor, preencha o Nome e o ID (Número p/ Ícone).");
      return;
    }

    setIsSavingWhatsapp(true);
    const id = (whatsappForm as any).id || Math.random().toString(36).substr(2, 9);
    const newAcc: WhatsAppAccount = {
      ...whatsappForm,
      id
    } as WhatsAppAccount;

    if (!user) {
      // Offline / guest mode local storage
      const exists = whatsappAccounts.some(a => a.id === id);
      const updatedAccounts = exists
        ? whatsappAccounts.map(a => a.id === id ? newAcc : a)
        : [...whatsappAccounts, newAcc];
      setWhatsappAccounts(updatedAccounts);
      localStorage.setItem('crm_whatsapp_accounts', JSON.stringify(updatedAccounts));
      
      setWhatsappForm({
        name: "",
        origin: "",
        color: "#25D366",
        phoneNumber: "",
        identifier: ""
      });
      setIsSavingWhatsapp(false);
      return;
    }

    if (!effectiveWorkspaceId) {
      alert("ID da workspace de destino não encontrado. Faça login ou verifique suas permissões.");
      setIsSavingWhatsapp(false);
      return;
    }

    try {
      await setDoc(doc(db, `users/${effectiveWorkspaceId}/whatsappAccounts`, id), {
        ...newAcc,
        createdAt: new Date().toISOString()
      });
      setWhatsappForm({
        name: "",
        origin: "",
        color: "#25D366",
        phoneNumber: "",
        identifier: ""
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, `users/${effectiveWorkspaceId}/whatsappAccounts/${id}`);
      alert("Erro ao salvar conta de WhatsApp. Por favor, verifique suas permissões do Firebase.");
    } finally {
      setIsSavingWhatsapp(false);
    }
  };

  const deleteWhatsappAccount = async (id: string) => {
    if (!user) {
      const updatedAccounts = whatsappAccounts.filter(a => a.id !== id);
      setWhatsappAccounts(updatedAccounts);
      localStorage.setItem('crm_whatsapp_accounts', JSON.stringify(updatedAccounts));
      return;
    }

    if (!effectiveWorkspaceId) return;
    try {
      await deleteDoc(doc(db, `users/${effectiveWorkspaceId}/whatsappAccounts`, id));
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, `users/${effectiveWorkspaceId}/whatsappAccounts/${id}`);
    }
  };

  const updateClientExtra = async (clientKey: string, updates: { trackingCode?: string; assignedWhatsappId?: string }) => {
    const currentData = clientExtraData[clientKey] || {};
    const newData = {
      clientKey,
      ...currentData,
      ...updates,
      updatedAt: new Date().toISOString()
    };

    try {
      if (user) {
        if (!effectiveWorkspaceId) return;
        const docRef = doc(db, `users/${effectiveWorkspaceId}/clientData`, clientKey);
        await setDoc(docRef, newData, { merge: true });

        if (updates.trackingCode) {
          addInteractionLog(clientKey, 'tracking_code', `Código de rastreio atualizado: ${updates.trackingCode}`);
        }
      } else {
        // Local storage persist for guest/offline mode
        const updatedData = {
          ...clientExtraData,
          [clientKey]: newData
        };
        localStorage.setItem('crm_client_extra_data', JSON.stringify(updatedData));
      }

      // Local update for immediate feedback
      setClientExtraData(prev => ({
        ...prev,
        [clientKey]: newData
      }));

      // Sync with Google Sheets if URL is configured
      if (sheetSyncUrl) {
        const client = clients.find(c => c.key === clientKey);
        const rowNumber = client?.leads?.[0]?.rowNumber;
        
        if (rowNumber) {
          fetch(sheetSyncUrl, {
            method: 'POST',
            mode: 'no-cors', // Google Apps Script requires this for cross-origin without complex headers
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              rowNumber,
              trackingCode: updates.trackingCode !== undefined ? updates.trackingCode : currentData.trackingCode,
              assignedWhatsappId: updates.assignedWhatsappId !== undefined ? updates.assignedWhatsappId : currentData.assignedWhatsappId,
              assignedWhatsappName: updates.assignedWhatsappId ? whatsappAccounts.find(a => a.id === updates.assignedWhatsappId)?.name : (updates.assignedWhatsappId === "" ? "" : undefined)
            })
          }).catch(err => console.error("Sync error:", err));
        }
      }
    } catch (error) {
      if (user) {
        // @ts-ignore
        handleFirestoreError(error, OperationType.WRITE, `users/${effectiveWorkspaceId}/clientData/${clientKey}`);
      } else {
        console.error("Erro ao salvar dados offline do cliente:", error);
      }
    }
  };

  const [clientTags, setClientTags] = useState<Record<string, ClientTag | null>>({});
  const [tagTimestamps, setTagTimestamps] = useState<Record<string, string>>({});
  const [paymentStatuses, setPaymentStatuses] = useState<Record<string, any>>({});
  const [potsCounts, setPotsCounts] = useState<Record<string, number>>({});
  const [interactionLogs, setInteractionLogs] = useState<Record<string, InteractionLog[]>>({});

  useEffect(() => {
    if (!authReady || !effectiveWorkspaceId) return;

    const unsubscribe = onSnapshot(collection(db, `users/${effectiveWorkspaceId}/history`), (snapshot) => {
      const logsByClient: Record<string, InteractionLog[]> = {};
      snapshot.docs.forEach(doc => {
        const data = doc.data() as InteractionLog;
        if (!logsByClient[data.clientKey]) logsByClient[data.clientKey] = [];
        logsByClient[data.clientKey].push({ ...data, id: doc.id });
      });
      // Sort logs by timestamp desc
      Object.keys(logsByClient).forEach(key => {
        logsByClient[key].sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
      });
      setInteractionLogs(logsByClient);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, `users/${effectiveWorkspaceId}/history`);
    });

    return () => unsubscribe();
  }, [authReady, effectiveWorkspaceId]);

  useEffect(() => {
    if (!authReady) return;

    if (!user) {
      const saved = localStorage.getItem('crm_client_tags');
      if (saved) {
        try {
          const parsed = JSON.parse(saved);
          const migrated: Record<string, any> = {};
          Object.entries(parsed).forEach(([key, val]) => {
            if (val === 'entrar em contato') migrated[key] = 'pendente';
            else if (val === 'contato enviado' || val === 'feito') migrated[key] = 'vendido';
            else migrated[key] = val;
          });
          setClientTags(migrated);
        } catch (e) {
          console.error("Erro ao carregar tags locais:", e);
        }
      }
      return;
    }

    if (!effectiveWorkspaceId) return;

    const unsubscribe = onSnapshot(collection(db, `users/${effectiveWorkspaceId}/tags`), (snapshot) => {
      const dbTags: Record<string, ClientTag | null> = {};
      const timestamps: Record<string, string> = {};
      
      snapshot.docs.forEach(doc => {
        const data = doc.data();
        // Fallback for legacy names and standardization
        let t = data.tag;
        if (t === 'feito' || t === 'contato enviado') t = 'vendido';
        if (t === 'entrar em contato' || t === 'pendente') t = 'reloginho';
        
        dbTags[data.clientKey] = t;
        if (data.updatedAt) timestamps[data.clientKey] = data.updatedAt;
      });
      
      setClientTags(prev => {
        const newTags = { ...prev };
        // First, incorporate all tags found in clientExtraData (potential legacy location)
        Object.entries(clientExtraData).forEach(([key, data]) => {
          const val = data as any;
          if (val.tag && !newTags[key]) {
            newTags[key] = val.tag;
          }
        });
        // Then override with authoritative data from 'tags' collection
        return { ...newTags, ...dbTags };
      });
      setTagTimestamps(timestamps);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, `users/${effectiveWorkspaceId}/tags`);
    });

    return () => unsubscribe();
  }, [authReady, user, effectiveWorkspaceId, clientExtraData]);

  const toggleTag = async (clientKey: string, tag: ClientTag) => {
    if (!effectiveWorkspaceId) return;
    
    // Use functional update to ensure we have the absolute latest state
    let resolvedNewTag: ClientTag | null = null;
    
    setClientTags(prev => {
      const current = prev[clientKey];
      resolvedNewTag = current === tag ? null : tag;
      return { ...prev, [clientKey]: resolvedNewTag };
    });

    const now = new Date().toISOString();

    if (!user) {
      const saved = localStorage.getItem('crm_client_tags');
      const parsed = saved ? JSON.parse(saved) : {};
      const updatedTags = { ...parsed, [clientKey]: resolvedNewTag };
      localStorage.setItem('crm_client_tags', JSON.stringify(updatedTags));
      return;
    }
    
    try {
      const tagRef = doc(db, `users/${effectiveWorkspaceId}/tags`, clientKey);
      if (resolvedNewTag === null) {
        await deleteDoc(tagRef);
        setTagTimestamps(prev => {
          const next = { ...prev };
          delete next[clientKey];
          return next;
        });
      } else {
        await setDoc(tagRef, {
          clientKey,
          tag: resolvedNewTag,
          updatedAt: now
        });
        setTagTimestamps(prev => ({ ...prev, [clientKey]: now }));
        addInteractionLog(clientKey, 'tag_change', `Tag alterada para: ${resolvedNewTag}`);
      }
    } catch (error) {
      // Revert on error
      setClientTags(prev => ({ ...prev, [clientKey]: clientTags[clientKey] }));
      handleFirestoreError(error, OperationType.WRITE, `users/${effectiveWorkspaceId}/tags/${clientKey}`);
    }

    // Sync to Google Sheets if webhook is configured
    if (webhookUrl) {
      try {
        const client = clients.find(c => c.key === clientKey);
        await fetch(webhookUrl, {
          method: 'POST',
          mode: 'no-cors',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            type: 'tag_update',
            clientKey,
            tag: resolvedNewTag || 'limpar',
            label: !resolvedNewTag ? '' : (resolvedNewTag === 'vendido' ? 'Vendido' : resolvedNewTag === 'reloginho' || resolvedNewTag === 'pendente' ? 'Pendente' : 'Lixo'),
            nome: client?.nome || '',
            telefone: client?.telefone || '',
            email: client?.email || '',
            timestamp: new Date().toISOString()
          })
        });
      } catch (error) {
        console.error("Erro ao sincronizar com a planilha:", error);
      }
    }
  };

  const handleGenerateMessage = async (lead: Lead) => {
    setSelectedLead(lead);
    setGenerating(true);
    setGeneratedMessage(null);
    const msg = await generatePersonalizedMessage(lead);
    setGeneratedMessage(msg);
    setGenerating(false);
  };

  useEffect(() => {
    setVisibleCount(50);
  }, [deferredSearchTerm, statusFilter, tagFilter, filterType]);

  const handleAddSale = async () => {
    if (!selectedClient || !saleForm.value) return;

    const product = MANUAL_PRODUCTS[saleForm.productIndex] as any;
    const value = parseFloat(saleForm.value.replace(',', '.'));
    const commission = product.fixedCommission !== undefined ? product.fixedCommission : value * (product.commissionRate || 0);
    
    const saleId = editingSaleId || Math.random().toString(36).substr(2, 9);
    
    // Create timestamp combining date and time
    const dateTimeStr = `${saleForm.date}T${saleForm.time}:00`;
    const timestamp = new Date(dateTimeStr).getTime();

    const newSale: ManualSale = {
      id: saleId,
      clientKey: selectedClient.key,
      productName: product.name,
      value,
      commission,
      date: saleForm.date, // keeping for backward compatibility
      timestamp: isNaN(timestamp) ? Date.now() : timestamp
    };

    if (!user) {
      const updatedSales = editingSaleId 
        ? manualSales.map(s => s.id === editingSaleId ? newSale : s)
        : [newSale, ...manualSales];
      setManualSales(updatedSales);
      localStorage.setItem('crm_manual_sales', JSON.stringify(updatedSales));
      setShowAddSaleModal(false);
      setEditingSaleId(null);
      setSaleForm({
        productIndex: 0,
        value: "",
        date: format(new Date(), 'yyyy-MM-dd'),
        time: format(new Date(), 'HH:mm')
      });
      toggleTag(newSale.clientKey, 'vendido');
      return;
    }

    try {
      await setDoc(doc(db, `users/${effectiveWorkspaceId}/sales`, saleId), newSale);
      addInteractionLog(newSale.clientKey, 'manual_sale', `Venda manual registrada: ${newSale.productName} (R$ ${newSale.value})`);
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, `users/${effectiveWorkspaceId}/sales/${saleId}`);
    }

    setShowAddSaleModal(false);
    setEditingSaleId(null);
    setSaleForm({
      productIndex: 0,
      value: "",
      date: format(new Date(), 'yyyy-MM-dd'),
      time: format(new Date(), 'HH:mm')
    });
    
    // Sync sale to Google Sheets if webhook is configured
    if (webhookUrl) {
      try {
        const client = clients.find(c => c.key === newSale.clientKey);
        fetch(webhookUrl, {
          method: 'POST',
          mode: 'no-cors',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            type: editingSaleId ? 'sale_updated' : 'sale_added',
            sale: newSale,
            clientKey: newSale.clientKey,
            nome: client?.nome || '',
            telefone: client?.telefone || '',
            email: client?.email || '',
            timestamp: new Date().toISOString()
          })
        });
      } catch (error) {
        console.error("Erro ao sincronizar venda com a planilha:", error);
      }
    }

    // Also update the tag to 'vendido'
    toggleTag(newSale.clientKey, 'vendido');
  };

  const handleEditSale = (sale: ManualSale) => {
    const client = enrichedClients.find(c => c.key === sale.clientKey);
    if (!client) return;
    
    setSelectedClient(client);
    setEditingSaleId(sale.id);
    
    // Find product index
    const pIndex = MANUAL_PRODUCTS.findIndex(p => p.name === sale.productName);
    
    // Attempt to extract time from timestamp if it's reasonably new
    const dateObj = new Date(sale.timestamp);
    const timeStr = format(dateObj, 'HH:mm');
    const dateStr = format(dateObj, 'yyyy-MM-dd');

    setSaleForm({
      productIndex: pIndex !== -1 ? pIndex : 0,
      value: sale.value.toString().replace('.', ','),
      date: dateStr,
      time: timeStr
    });
    setShowAddSaleModal(true);
  };

  const handleDeleteSale = async (saleId: string) => {
    const saleToDelete = manualSales.find(s => s.id === saleId);

    if (!user) {
      const updatedSales = manualSales.filter(s => s.id !== saleId);
      setManualSales(updatedSales);
      localStorage.setItem('crm_manual_sales', JSON.stringify(updatedSales));
    } else {
      try {
        await deleteDoc(doc(db, `users/${effectiveWorkspaceId}/sales`, saleId));
      } catch (error) {
        handleFirestoreError(error, OperationType.DELETE, `users/${effectiveWorkspaceId}/sales/${saleId}`);
      }
    }

    // Sync deletion to Google Sheets if webhook is configured
    if (webhookUrl && saleToDelete) {
      try {
        const client = clients.find(c => c.key === saleToDelete.clientKey);
        fetch(webhookUrl, {
          method: 'POST',
          mode: 'no-cors',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            type: 'sale_deleted',
            saleId: saleId,
            clientKey: saleToDelete.clientKey,
            nome: client?.nome || '',
            telefone: client?.telefone || '',
            email: client?.email || '',
            timestamp: new Date().toISOString()
          })
        });
      } catch (error) {
        console.error("Erro ao sincronizar exclusão de venda:", error);
      }
    }
  };

  const fetchData = async () => {
    setRefreshing(true);
    try {
      const response = await fetch(SHEET_CSV_URL);
      const csvText = await response.text();
      
      Papa.parse(csvText, {
        header: true,
        skipEmptyLines: true,
        transformHeader: (header) => header.trim().toLowerCase(),
        complete: (results) => {
          // If PapaParse header: true is used, we can still get the record as an array-like if we need indices
          // However, results.data is already mapped. Let's get the headers in order.
          const headers = results.meta.fields || [];
          const eHeader = headers[4];  // Column E
          const vHeader = headers[21]; // Column V

          const rawLeads: Lead[] = results.data.map((row: any, index: number) => {
            const dateStr = row['data'] || '';
            const timeStr = row['hora'] || '';
            let timestamp = 0;
            try {
              if (dateStr && timeStr) {
                // Formatting date and time
                let parsedDate = parse(`${dateStr} ${timeStr}`, 'dd/MM/yyyy HH:mm:ss', new Date());
                if (isNaN(getTime(parsedDate))) {
                  parsedDate = parse(`${dateStr} ${timeStr}`, 'dd/MM/yyyy HH:mm', new Date());
                }
                timestamp = isNaN(getTime(parsedDate)) ? 0 : getTime(parsedDate);
              }
            } catch (e) {
              timestamp = 0;
            }

            const rawValor = row['valor'] || row['vlr'] || '0';
            let cleanValor = rawValor.toString().replace(/[R$\s]/g, '');
            
            if (cleanValor.includes(',') && cleanValor.includes('.')) {
              if (cleanValor.indexOf('.') < cleanValor.indexOf(',')) {
                cleanValor = cleanValor.replace(/\./g, '').replace(',', '.');
              } else {
                cleanValor = cleanValor.replace(/,/g, '');
              }
            } else if (cleanValor.includes(',')) {
              cleanValor = cleanValor.replace(',', '.');
            }
            
            const leadValue = parseFloat(cleanValor);
            const rawStatus = (row['status'] || 'Pendente').trim().toLowerCase();
            let normalizedStatus = 'Pendente';
            
            let telefoneRaw = (row['telefone'] || row['whatsapp'] || row['celular'] || row['phone'] || '').toString().trim();
            let emailRaw = (row['email'] || row['e-mail'] || row['mail'] || '').toString().trim();

            const cleanedTelefone = cleanPhone(telefoneRaw);
            const productFromE = eHeader ? (row[eHeader] || '').toString().trim() : '';

            if (rawStatus.startsWith('approved') || rawStatus === 'aprovado' || rawStatus === 'paid' || rawStatus === 'pago' || rawStatus === 'succeeded' || rawStatus === 'success' || rawStatus === 'concluido' || rawStatus === 'completo') {
              normalizedStatus = 'Aprovado';
            } else if (rawStatus.startsWith('pending') || rawStatus === 'pendente' || rawStatus === 'aguardando' || rawStatus === 'aguardando pagamento' || rawStatus === 'waiting_payment') {
              normalizedStatus = 'Pendente';
            } else if (rawStatus === 'refused' || rawStatus === 'cartao recusado' || rawStatus === 'cartão recusado' || rawStatus === 'rejected' || rawStatus === 'cancelado' || rawStatus === 'recusado') {
              normalizedStatus = 'Recusado';
            } else if (rawStatus === 'reembolsado' || rawStatus === 'devolvido') {
              normalizedStatus = 'Reembolsado';
            } else if (rawStatus === 'abandonado' || rawStatus === 'carrinho abandonado' || rawStatus === 'lost_cart') {
              normalizedStatus = 'Carrinho Abandonado';
            } else if (rawStatus.startsWith('expired') || rawStatus === 'expirado') {
              normalizedStatus = 'Expirado';
            } else if (rawStatus === 'lixo') {
              normalizedStatus = 'Lixo';
            }

            const paymentMethodStr = row['tipo de pagamento'] || '';
            const checkoutUrlFromV = vHeader ? (row[vHeader] || '').toString().trim() : '';

            return {
              id: row['id'] || Math.random().toString(36).substr(2, 9),
              nome: (row['nome'] || 'Sem Nome').trim(),
              telefone: cleanedTelefone,
              email: emailRaw,
              produto: productFromE || (row['produto'] || '').trim(),
              valor: isNaN(leadValue) ? 'R$ 0,00' : `R$ ${leadValue.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`,
              status: normalizedStatus,
              codPay: (row['cod pay'] || '').trim(),
              checkoutUrl: checkoutUrlFromV || (row['checkout_link'] || row['checkout'] || '').trim(),
              data: dateStr,
              hora: timeStr,
              timestamp,
              numericValue: isNaN(leadValue) ? 0 : leadValue,
              paymentMethod: paymentMethodStr || undefined,
              rowNumber: index + 2,
              // UTM Mapping
              src: (row['src'] || '').trim(),
              sck: (row['sck'] || '').trim(),
              utm_source: (row['utm_source'] || '').trim(),
              utm_medium: (row['utm_medium'] || '').trim(),
              utm_campaign: (row['utm_campaign'] || '').trim(),
              utm_content: (row['utm_content'] || '').trim(),
              utm_term: (row['utm_term'] || '').trim(),
              ttcid: (row['ttcid'] || '').trim(),
              adId: (row['ad id'] || '').trim(),
              tags: (row['tags'] || '').trim()
            };
          });

          const clientsList: Client[] = [];
          const emailMap = new Map<string, Client>();
          const phoneMap = new Map<string, Client>();
          const nameMap = new Map<string, Client>();
          
          rawLeads.forEach(lead => {
            const emailKey = lead.email?.toLowerCase().trim();
            const phoneKey = lead.telefone?.trim();
            const nameKey = lead.nome?.toLowerCase().trim();
            
            let existing: Client | undefined;
            if (emailKey && emailMap.has(emailKey)) {
              existing = emailMap.get(emailKey);
            } else if (phoneKey && phoneMap.has(phoneKey)) {
              existing = phoneMap.get(phoneKey);
            } else if (nameKey && nameMap.has(nameKey) && nameKey !== 'sem nome') {
              // Fallback to name merging if no email/phone match
              existing = nameMap.get(nameKey);
            }

            if (existing) {
              existing.leads.push(lead);
              
              // Update with better data if available
              // Prioritize valid phones over invalid/empty ones
              const currentPhoneValid = isValidPhone(existing.telefone);
              const newPhoneValid = isValidPhone(lead.telefone);

              if (!currentPhoneValid && newPhoneValid) {
                existing.telefone = lead.telefone;
                if (lead.telefone) phoneMap.set(lead.telefone, existing);
              } else if (!existing.telefone && lead.telefone) {
                existing.telefone = lead.telefone;
                if (lead.telefone) phoneMap.set(lead.telefone, existing);
              }

              if (!existing.email && lead.email) {
                existing.email = lead.email;
                emailMap.set(lead.email.toLowerCase().trim(), existing);
              }

              if (existing.nome === 'Sem Nome' && lead.nome !== 'Sem Nome') {
                existing.nome = lead.nome;
                if (nameKey) nameMap.set(nameKey, existing);
              }
              
              const leadValue = lead.numericValue;
              const isAprovado = lead.status === 'Aprovado';
              if (isAprovado) {
                existing.totalSpent += leadValue;
                existing.status = 'Aprovado';
              }
              
              if (lead.timestamp > existing.lastPurchaseTimestamp) {
                existing.lastPurchaseDate = lead.data;
                existing.lastPurchaseTimestamp = lead.timestamp;
                if (existing.status !== 'Aprovado') {
                  existing.status = lead.status;
                }
              }
            } else {
              // Deterministic key: phone OR email OR name
              // BUT we prefix it to avoid collisions between different types
              const clientKey = lead.telefone ? `tel_${lead.telefone}` : (lead.email ? `email_${lead.email.toLowerCase()}` : `name_${lead.nome.toLowerCase()}`);
              
              const newClient: Client = {
                email: lead.email,
                nome: lead.nome,
                telefone: lead.telefone,
                key: clientKey,
                leads: [lead],
                totalSpent: lead.status === 'Aprovado' ? lead.numericValue : 0,
                lastPurchaseDate: lead.data,
                lastPurchaseTimestamp: lead.timestamp,
                status: lead.status
              };
              clientsList.push(newClient);
              if (emailKey) emailMap.set(emailKey, newClient);
              if (phoneKey) phoneMap.set(phoneKey, newClient);
              if (nameKey && nameKey !== 'sem nome') nameMap.set(nameKey, newClient);
            }
          });

          // Pass everything to setClients, auto-tagging is now derived
          const sortedClients = clientsList.map(client => {
            // Guarantee stable key based on the best available identifier after merging
            const phone = client.leads.find(l => l.telefone)?.telefone || client.telefone;
            const email = client.leads.find(l => l.email)?.email || client.email;
            const name = client.leads.find(l => l.nome && l.nome !== 'Sem Nome')?.nome || client.nome;
            
            const stableKey = phone ? `tel_${phone}` : (email ? `email_${email.toLowerCase()}` : `name_${name.toLowerCase()}`);

            return {
              ...client,
              key: stableKey,
              leads: client.leads.sort((a, b) => {
                if (b.timestamp !== a.timestamp) return b.timestamp - a.timestamp;
                if (b.status === 'Aprovado' && a.status !== 'Aprovado') return 1;
                if (a.status === 'Aprovado' && b.status !== 'Aprovado') return -1;
                return 0;
              })
            };
          }).sort((a, b) => b.lastPurchaseTimestamp - a.lastPurchaseTimestamp);

          setClients(sortedClients);
          setLoading(false);
          setRefreshing(false);
        },
        error: (error: any) => {
          console.error("Erro ao processar CSV:", error);
          setLoading(false);
          setRefreshing(false);
        }
      });
    } catch (error) {
      console.error("Erro ao buscar dados:", error);
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const enrichedClients = useMemo(() => {
    // Map manual sales to client keys for faster lookup
    const salesByClient = new Map<string, ManualSale[]>();
    manualSales.forEach(sale => {
      const list = salesByClient.get(sale.clientKey) || [];
      list.push(sale);
      salesByClient.set(sale.clientKey, list);
    });

    return clients.map(client => {
      const clientManualSales = salesByClient.get(client.key) || [];
      const manualSpent = clientManualSales.reduce((sum, s) => sum + s.value, 0);
      const totalSpent = client.totalSpent + manualSpent;
      
      // Prioritize "Aprovado" status if there are any sales (manual or leads)
      let status = client.status;
      if (totalSpent > 0 && status !== 'Aprovado') {
        status = 'Aprovado';
      }

      return {
        ...client,
        totalSpent,
        status,
        manualSales: clientManualSales,
        trackingCode: clientExtraData[client.key]?.trackingCode,
        assignedWhatsappId: clientExtraData[client.key]?.assignedWhatsappId
      };
    });
  }, [clients, manualSales, clientExtraData]);

  const filteredClients = useMemo(() => {
    const now = new Date();
    let start: Date | null = null;
    let end: Date | null = now;

    if (filterType === 'today') {
      start = startOfDay(now);
      end = endOfDay(now);
    } else if (filterType === 'week') {
      start = startOfWeek(now, { weekStartsOn: 0 }); // Sunday
    } else if (filterType === 'month') {
      start = startOfMonth(now);
    } else if (filterType === 'custom' && customStartDate && customEndDate) {
      start = startOfDay(parse(customStartDate, 'yyyy-MM-dd', new Date()));
      end = endOfDay(parse(customEndDate, 'yyyy-MM-dd', new Date()));
    }

    const manualSalesKeys = new Set(manualSales.map(s => s.clientKey));

    return enrichedClients.filter(client => {
      const clientKey = client.key;
      const tag = getClientTag(client);

      if (showOnlyManualSales && !manualSalesKeys.has(clientKey)) return false;

      const matchesSearch = 
        client.nome.toLowerCase().includes(deferredSearchTerm.toLowerCase()) ||
        client.email.toLowerCase().includes(deferredSearchTerm.toLowerCase()) ||
        client.telefone.includes(deferredSearchTerm);
      
      const matchesStatus = statusFilter === 'all' || client.status === statusFilter;
      const matchesTag = tagFilter === 'all' || (tagFilter === 'enviar msg' ? tag === null : tag === tagFilter);

      let matchesDate = true;
      if (filterType !== 'all') {
        if (filterType === 'custom' && (!customStartDate || !customEndDate)) {
          matchesDate = true;
        } else {
          matchesDate = client.leads.some(l => {
            const leadDate = new Date(l.timestamp);
            return isWithinInterval(leadDate, { start: start!, end: end! });
          });
        }
      }
      
      return matchesSearch && matchesStatus && matchesTag && matchesDate;
    });
  }, [enrichedClients, deferredSearchTerm, filterType, customStartDate, customEndDate, statusFilter, tagFilter, clientTags, showOnlyManualSales, manualSales]);

  const currentSelectedClient = useMemo(() => {
    if (!selectedClient) return null;
    return enrichedClients.find(c => c.key === selectedClient.key) || selectedClient;
  }, [selectedClient, enrichedClients]);

  const pagedClients = useMemo(() => {
    return filteredClients.slice(0, visibleCount);
  }, [filteredClients, visibleCount]);

  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const { scrollTop, scrollHeight, clientHeight } = e.currentTarget;
    if (scrollHeight - scrollTop <= clientHeight + 100) {
      if (visibleCount < filteredClients.length) {
        setVisibleCount(prev => prev + 50);
      }
    }
  };

  const stats = useMemo(() => {
    const totalClients = enrichedClients.length;
    const activeClients = enrichedClients.filter(c => c.totalSpent > 0).length;
    const totalRevenue = enrichedClients.reduce((acc, curr) => acc + curr.totalSpent, 0);
    
    const manualRevenue = manualSales.reduce((acc, curr) => acc + curr.value, 0);
    const totalCommission = manualSales.reduce((acc, curr) => acc + curr.commission, 0);

    const currentMonthKey = format(new Date(), 'yyyy-MM');
    const currentMonthCommission = manualSales
      .filter(s => {
        const [year, month] = s.date.split('-');
        return `${year}-${month}` === currentMonthKey;
      })
      .reduce((acc, curr) => acc + curr.commission, 0);

    return { totalClients, activeClients, totalRevenue, manualRevenue, totalCommission, currentMonthCommission };
  }, [enrichedClients, manualSales]);

  const dashboardData = useMemo(() => {
    const dailyMap = new Map<string, { date: string; value: number; commission: number; count: number }>();
    
    manualSales.forEach(sale => {
      const date = sale.date;
      const existing = dailyMap.get(date) || { date, value: 0, commission: 0, count: 0 };
      existing.value += sale.value;
      existing.commission += sale.commission;
      existing.count += 1;
      dailyMap.set(date, existing);
    });

    return Array.from(dailyMap.values()).sort((a, b) => a.date.localeCompare(b.date));
  }, [manualSales]);

  const monthlyData = useMemo(() => {
    const monthlyMap = new Map<string, { month: string; monthName: string; value: number; commission: number; count: number }>();
    
    manualSales.forEach(sale => {
      const [year, month, day] = sale.date.split('-').map(Number);
      const date = new Date(year, month - 1, day);
      const monthKey = format(date, 'yyyy-MM');
      const monthName = format(date, 'MMMM yyyy', { locale: ptBR });
      
      const existing = monthlyMap.get(monthKey) || { month: monthKey, monthName, value: 0, commission: 0, count: 0 };
      existing.value += sale.value;
      existing.commission += sale.commission;
      existing.count += 1;
      monthlyMap.set(monthKey, existing);
    });

    return Array.from(monthlyMap.values()).sort((a, b) => b.month.localeCompare(a.month));
  }, [manualSales]);

  const uniqueStatuses = useMemo(() => {
    const statuses = new Set(enrichedClients.map(c => c.status));
    return Array.from(statuses).sort();
  }, [enrichedClients]);

  const followupClients = useMemo(() => {
    return enrichedClients.filter(client => {
      const clientKey = client.key;
      const tag = clientTags[clientKey];
      const tagDateStr = tagTimestamps[clientKey];
      const pStatus = paymentStatuses[clientKey];
      const potCount = potsCounts[clientKey];
      const lastPurchase = client.lastPurchaseDate ? new Date(client.lastPurchaseDate) : null;
      const now = new Date();

      // Rule 1: Reloginho (1 day)
      if (tag === 'reloginho' && tagDateStr) {
        if (differenceInDays(now, new Date(tagDateStr)) >= 1) return true;
      }

      // Rule 2: Pix (1 hour)
      if (pStatus?.status === 'pix_enviado' && pStatus?.updatedAt) {
        if (differenceInHours(now, new Date(pStatus.updatedAt)) >= 1) return true;
      }

      // Rule 3: Link (1 hour)
      if (pStatus?.status === 'link_enviado' && pStatus?.updatedAt) {
        if (differenceInHours(now, new Date(pStatus.updatedAt)) >= 1) return true;
      }

      // Rule 4: Boleto (2 days)
      if (pStatus?.status === 'boleto_enviado' && pStatus?.updatedAt) {
        if (differenceInDays(now, new Date(pStatus.updatedAt)) >= 2) return true;
      }

      // Rule 5: Pots (Infer from product if not manually set)
      let effectivePotCount = potCount || 0;
      if (effectivePotCount === 0 && client.leads?.[0]?.produto) {
        const prodName = client.leads[0].produto.toLowerCase();
        if (prodName.includes('6 pote')) effectivePotCount = 6;
        else if (prodName.includes('3 pote')) effectivePotCount = 3;
        else if (prodName.includes('1 pote')) effectivePotCount = 1;
      }

      if (effectivePotCount > 0 && lastPurchase) {
        const daysSince = differenceInDays(now, lastPurchase);
        if (effectivePotCount === 1 && daysSince >= 45) return true;
        if (effectivePotCount === 3 && daysSince >= 105) return true;
        if (effectivePotCount === 6 && daysSince >= 195) return true;
      }

      return false;
    });
  }, [enrichedClients, clientTags, tagTimestamps, paymentStatuses, potsCounts]);

  const whatsappStats = useMemo(() => {
    const distributionMap = new Map<string, number>();
    const salesValueMap = new Map<string, number>();
    const salesCountMap = new Map<string, number>();

    enrichedClients.forEach(client => {
      // Exclude "lixo"
      const tag = getClientTag(client);
      if (tag === 'lixo') return;

      const whatsappId = client.assignedWhatsappId;
      const account = whatsappAccounts.find(a => a.id === whatsappId);
      const name = account ? account.name : 'Não Atribuído';

      // Distribution count
      distributionMap.set(name, (distributionMap.get(name) || 0) + 1);

      // Manual Sales value
      if (whatsappId && client.manualSales) {
        const totalValue = client.manualSales.reduce((acc, s) => acc + s.value, 0);
        if (totalValue > 0) {
          salesValueMap.set(name, (salesValueMap.get(name) || 0) + totalValue);
          salesCountMap.set(name, (salesCountMap.get(name) || 0) + client.manualSales.length);
        }
      }
    });

    const distributionData = Array.from(distributionMap.entries()).map(([name, value]) => {
      const account = whatsappAccounts.find(a => a.name === name);
      return { 
        name, 
        value, 
        color: account ? account.color : '#cbd5e1' 
      };
    }).sort((a, b) => b.value - a.value);

    // For sales data, always include all accounts even if value is 0
    const salesData = whatsappAccounts.map(acc => ({
      name: acc.name,
      value: salesValueMap.get(acc.name) || 0,
      count: salesCountMap.get(acc.name) || 0,
      color: acc.color
    })).sort((a, b) => b.value - a.value);

    // Also handle "Não Atribuído" if there were sales (unlikely due to UI logic but good for completeness)
    if (salesValueMap.has('Não Atribuído')) {
      salesData.push({
        name: 'Não Atribuído',
        value: salesValueMap.get('Não Atribuído') || 0,
        count: salesCountMap.get('Não Atribuído') || 0,
        color: '#cbd5e1'
      });
    }

    // Peak Hour logic
    const hourlyDistribution = Array.from({ length: 24 }, (_, i) => ({ 
      hour: i, 
      label: `${i}h`, 
      count: 0, 
      value: 0 
    }));

    // Day of week logic (0=Domingo, 1=Segunda...)
    const dayLabels = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
    const dailyDistribution = dayLabels.map(label => ({
      day: label,
      count: 0,
      value: 0
    }));

    manualSales.forEach(sale => {
      // Historical data might not have a precise timestamp, fallback to date
      const saleDate = sale.timestamp ? new Date(sale.timestamp) : new Date(sale.date + 'T12:00:00');
      if (isNaN(saleDate.getTime())) return;

      // Hourly
      const hour = saleDate.getHours();
      hourlyDistribution[hour].count += 1;
      hourlyDistribution[hour].value += sale.value;

      // Daily
      const dayIndex = saleDate.getDay();
      dailyDistribution[dayIndex].count += 1;
      dailyDistribution[dayIndex].value += sale.value;
    });

    return { 
      distributionData, 
      salesData, 
      hourlyDistribution,
      dailyDistribution
    };
  }, [enrichedClients, whatsappAccounts, manualSales, clientTags, clientExtraData]);

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="flex h-screen overflow-hidden bg-modern-bg font-sans">
      {/* Main Content */}
      <main className="flex-1 flex flex-col overflow-hidden">
        {/* Header - Simple Style */}
        <header className="h-20 px-10 glass-header flex items-center justify-between shrink-0 z-10">
          <div className="flex items-center gap-6">
            <div className="w-10 h-10 bg-modern-primary rounded-none flex items-center justify-center text-white shadow-lg shadow-modern-primary/20">
              <Package size={20} />
            </div>
            <div className="flex items-center gap-4">
              <h1 className="text-lg font-bold tracking-tight text-modern-text">Dominus CRM</h1>
              <div className="h-4 w-px bg-modern-border" />
              <p className="text-xs font-semibold text-modern-secondary">Controle de Leads</p>
            </div>
            {effectiveOwnerEmail && user && effectiveOwnerEmail !== user.email && (
              <div className="flex items-center gap-2 px-3 py-1.5 bg-emerald-50 border border-emerald-200 text-emerald-800 text-[10px] font-black uppercase tracking-tighter">
                <Users size={12} className="text-emerald-500" />
                Dono: {effectiveOwnerEmail.split('@')[0]}
              </div>
            )}
            <div className="flex items-center gap-2 ml-4">
              <button 
                onClick={() => setShowOnlyManualSales(!showOnlyManualSales)}
                className={cn(
                  "px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider border transition-all",
                  showOnlyManualSales 
                    ? "bg-emerald-600 border-emerald-600 text-white" 
                    : "bg-white border-modern-border text-modern-secondary hover:border-modern-primary"
                )}
              >
                {showOnlyManualSales ? "Mostrando: Com Vendas" : "Filtrar: Com Vendas"}
              </button>
            </div>
          </div>
          
          <div className="flex items-center gap-6">
            <div className="hidden lg:flex gap-6">
              <div className="text-right">
                <p className="text-[9px] font-bold uppercase tracking-wider text-modern-secondary">Minha Comissão</p>
                <p className="text-sm font-bold text-emerald-600">
                  {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(stats.totalCommission)}
                </p>
              </div>
              <div className="text-right">
                <p className="text-[9px] font-bold uppercase tracking-wider text-modern-secondary">Vendas Manuais</p>
                <p className="text-sm font-bold text-modern-text">
                  {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(stats.manualRevenue)}
                </p>
              </div>
              <div className="text-right">
                <p className="text-[9px] font-bold uppercase tracking-wider text-modern-secondary">Total Planilha</p>
                <p className="text-sm font-bold text-modern-text">
                  {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(stats.totalRevenue)}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
               <button 
                onClick={() => setView(view === 'followup' ? 'crm' : 'followup')}
                className={cn(
                  "w-10 h-10 border border-modern-border rounded-none flex items-center justify-center transition-all shadow-sm",
                  view === 'followup' ? "bg-modern-primary text-white" : "bg-white text-modern-secondary hover:text-modern-primary"
                )}
                title="Ver Follow-up"
              >
                <Clock size={18} />
              </button>
              <button 
                onClick={() => setView(view === 'dashboard' ? 'crm' : 'dashboard')}
                className={cn(
                  "w-10 h-10 border border-modern-border rounded-none flex items-center justify-center transition-all shadow-sm",
                  view === 'dashboard' ? "bg-modern-primary text-white" : "bg-white text-modern-secondary hover:text-modern-primary"
                )}
                title={view === 'dashboard' ? "Ver CRM" : "Ver Dashboard"}
              >
                {view === 'dashboard' ? <Users size={18} /> : <LayoutDashboard size={18} />}
              </button>
              <button 
                onClick={() => setShowSettings(true)}
                className="w-10 h-10 bg-white border border-modern-border rounded-none flex items-center justify-center text-modern-secondary hover:text-modern-primary transition-all shadow-sm"
                title="Configurações de Sincronização"
              >
                <Settings size={18} />
              </button>
              <button 
                onClick={() => setShowWhatsappManager(true)}
                className="w-10 h-10 bg-white border border-modern-border rounded-none flex items-center justify-center text-modern-secondary hover:text-emerald-600 transition-all shadow-sm"
                title="Gerenciar WhatsApps"
              >
                <Phone size={18} />
              </button>
              <button 
                onClick={fetchData}
                disabled={refreshing}
                className="w-10 h-10 bg-white border border-modern-border rounded-none flex items-center justify-center text-modern-secondary hover:text-modern-primary transition-all disabled:opacity-30 shadow-sm"
              >
                <RefreshCw size={18} strokeWidth={2.5} className={cn(refreshing && "animate-spin")} />
              </button>
            </div>
          </div>
        </header>
        
        <div className="flex-1 overflow-hidden flex flex-col">
          {view === 'followup' ? (
            <div className="flex-1 overflow-y-auto p-10 space-y-10 custom-scrollbar">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-2xl font-bold text-modern-text">Dashboard de Follow-up</h2>
                  <p className="text-[11px] font-bold uppercase tracking-widest text-modern-secondary mt-1">Leads aguardando retorno baseado em regras de tempo</p>
                </div>
                <div className="bg-white border border-modern-border px-6 py-4 shadow-sm flex items-center gap-4">
                   <Clock size={20} className="text-modern-primary" />
                   <div>
                     <p className="text-[9px] font-black uppercase text-modern-secondary tracking-widest leading-none mb-1">Aguardando Retorno</p>
                     <p className="text-xl font-black text-modern-text leading-none">{followupClients.length}</p>
                   </div>
                </div>
              </div>

              <div className="bg-white border border-modern-border overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-separate border-spacing-0">
                    <thead>
                      <tr className="bg-[#f8f9fa]">
                        <th className="px-4 py-3 text-[11px] font-black text-modern-secondary uppercase tracking-widest border-b border-r border-[#dadce0]">Lead</th>
                        <th className="px-4 py-3 text-[11px] font-black text-modern-secondary uppercase tracking-widest border-b border-r border-[#dadce0]">Motivo Follow-up</th>
                        <th className="px-4 py-3 text-[11px] font-black text-modern-secondary uppercase tracking-widest border-b border-r border-[#dadce0]">Tempo Decorrido</th>
                        <th className="px-4 py-3 text-[11px] font-black text-modern-secondary uppercase tracking-widest border-b border-[#dadce0] text-center">Ações</th>
                      </tr>
                    </thead>
                    <tbody>
                      {followupClients.map(client => {
                        const tag = clientTags[client.key];
                        const tagDateStr = tagTimestamps[client.key];
                        const pStatus = paymentStatuses[client.key];
                        const potCount = potsCounts[client.key];
                        const now = new Date();

                        let reason = "";
                        let displayTime = "";
                        
                        if (tag === 'reloginho' && tagDateStr) {
                           reason = "Follow-up Manual (Reloginho)";
                           displayTime = `${differenceInDays(now, new Date(tagDateStr))} dias`;
                        } else if (pStatus?.status === 'pix_enviado' && pStatus?.updatedAt) {
                           reason = "Cobrança de Pix Enviado";
                           displayTime = `${differenceInHours(now, new Date(pStatus.updatedAt))} horas`;
                        } else if (pStatus?.status === 'link_enviado' && pStatus?.updatedAt) {
                           reason = "Cobrança de Link de Pagamento";
                           displayTime = `${differenceInHours(now, new Date(pStatus.updatedAt))} horas`;
                        } else if (pStatus?.status === 'boleto_enviado' && pStatus?.updatedAt) {
                           reason = "Cobrança de Boleto";
                           displayTime = `${differenceInDays(now, new Date(pStatus.updatedAt))} dias`;
                        } else if (potCount > 0 && client.lastPurchaseDate) {
                           reason = `Recompra - ${potCount} Pote(s)`;
                           displayTime = `${differenceInDays(now, new Date(client.lastPurchaseDate))} dias desde a compra`;
                        }

                        return (
                          <tr key={client.key} className="hover:bg-slate-50 transition-all cursor-pointer" onClick={() => { setSelectedClient(client); setView('crm'); }}>
                            <td className="px-4 py-4 border-b border-r border-[#dadce0]">
                              <div className="flex items-center gap-3">
                                <div className="w-8 h-8 flex items-center justify-center bg-modern-primary/10 text-modern-primary font-black text-[11px]">
                                  {client.nome.charAt(0)}
                                </div>
                                <div>
                                  <p className="text-xs font-bold text-modern-text">{client.nome}</p>
                                  <p className="text-[10px] text-modern-secondary">{client.telefone}</p>
                                </div>
                              </div>
                            </td>
                            <td className="px-4 py-4 border-b border-r border-[#dadce0]">
                              <div className="flex items-center gap-2">
                                 <AlertCircle size={14} className="text-orange-500" />
                                 <span className="text-[11px] font-bold text-modern-text uppercase tracking-tight">{reason}</span>
                              </div>
                            </td>
                            <td className="px-4 py-4 border-b border-r border-[#dadce0]">
                               <p className="text-xs font-bold text-modern-secondary">{displayTime}</p>
                            </td>
                            <td className="px-4 py-4 border-b border-[#dadce0]">
                              <div className="flex items-center justify-center gap-2" onClick={e => e.stopPropagation()}>
                                 <button 
                                   onClick={(e) => {
                                     e.stopPropagation();
                                     const msg = `Olá ${client.nome}, estou passando para...`;
                                     const url = `https://wa.me/${client.telefone.replace(/\D/g, '')}?text=${encodeURIComponent(msg)}`;
                                     window.open(url, '_blank');
                                   }}
                                   className="px-3 py-1.5 bg-emerald-600 text-white text-[10px] font-black uppercase tracking-widest hover:bg-emerald-700 transition-all"
                                 >
                                   Chamar no Zap
                                 </button>
                                 <button 
                                   onClick={(e) => {
                                      e.stopPropagation();
                                      toggleTag(client.key, 'contato_sucesso');
                                   }}
                                   className="px-3 py-1.5 bg-white border border-modern-border text-modern-secondary text-[10px] font-black uppercase tracking-widest hover:bg-slate-50 transition-all"
                                 >
                                   Resolvido
                                 </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                      {followupClients.length === 0 && (
                        <tr>
                          <td colSpan={4} className="px-4 py-20 text-center">
                            <Clock size={40} className="mx-auto text-modern-border mb-4 opacity-20" />
                            <p className="text-sm font-bold text-modern-secondary uppercase tracking-widest">Tudo em dia! Nenhum follow-up pendente.</p>
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          ) : view === 'crm' ? (
            <>
              <div className="px-10 py-6 flex flex-wrap items-center gap-6 shrink-0">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-modern-secondary" size={18} />
            <input 
              type="text" 
              placeholder="Pesquisar clientes..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-12 pr-4 py-3.5 bg-white border border-modern-border rounded-none text-sm font-medium focus:outline-none focus:ring-4 focus:ring-modern-primary/5 transition-all placeholder:text-modern-secondary/40 shadow-sm"
            />
          </div>

                      <div className="relative z-[60]">
                        <button 
                          onClick={() => setShowFilterMenu(!showFilterMenu)}
                          className="flex items-center gap-3 bg-white border border-modern-border rounded-none px-5 py-3 shadow-sm hover:bg-slate-50 transition-colors text-sm font-bold text-modern-text"
                        >
                          <Filter size={18} className="text-modern-secondary" />
                          <span>Filtros</span>
                          <ChevronDown size={16} className={cn("text-modern-secondary transition-transform", showFilterMenu && "rotate-180")} />
                        </button>

                        <AnimatePresence>
                          {showFilterMenu && (
                            <>
                              <motion.div 
                                initial={{ opacity: 0 }}
                                animate={{ opacity: 1 }}
                                exit={{ opacity: 0 }}
                                onClick={() => setShowFilterMenu(false)}
                                className="fixed inset-0 z-[65]"
                              />
                              <motion.div 
                                initial={{ opacity: 0, y: 10, scale: 0.95 }}
                                animate={{ opacity: 1, y: 0, scale: 1 }}
                                exit={{ opacity: 0, y: 10, scale: 0.95 }}
                                className="absolute right-0 mt-3 w-80 bg-white border border-modern-border rounded-none shadow-2xl z-[70] overflow-hidden p-4 space-y-6"
                              >
                      {/* Período */}
                      <div className="space-y-2">
                        <p className="text-[10px] font-bold uppercase tracking-wider text-modern-secondary px-1">Período</p>
                        <div className="grid grid-cols-2 gap-2">
                          {[
                            { id: 'all', label: 'Todos' },
                            { id: 'today', label: 'Hoje' },
                            { id: 'week', label: 'Semana' },
                            { id: 'month', label: 'Mês' },
                            { id: 'custom', label: 'Personalizado' }
                          ].map((item) => (
                            <button
                              key={item.id}
                              onClick={() => setFilterType(item.id as any)}
                              className={cn(
                                "text-left px-3 py-2 rounded-none text-[11px] font-bold transition-colors border",
                                filterType === item.id 
                                  ? "bg-modern-primary/10 border-modern-primary/20 text-modern-primary" 
                                  : "bg-white border-modern-border text-modern-text hover:bg-slate-50"
                              )}
                            >
                              {item.label}
                            </button>
                          ))}
                        </div>
                        {filterType === 'custom' && (
                          <div className="mt-2 p-3 bg-slate-50 border border-modern-border space-y-3">
                            <div className="space-y-1">
                              <p className="text-[9px] font-bold uppercase text-modern-secondary">Início</p>
                              <input 
                                type="date" 
                                value={customStartDate}
                                onChange={(e) => setCustomStartDate(e.target.value)}
                                className="w-full bg-white border border-modern-border rounded-none px-2 py-1.5 text-[11px] font-bold text-modern-text focus:outline-none"
                              />
                            </div>
                            <div className="space-y-1">
                              <p className="text-[9px] font-bold uppercase text-modern-secondary">Fim</p>
                              <input 
                                type="date" 
                                value={customEndDate}
                                onChange={(e) => setCustomEndDate(e.target.value)}
                                className="w-full bg-white border border-modern-border rounded-none px-2 py-1.5 text-[11px] font-bold text-modern-text focus:outline-none"
                              />
                            </div>
                          </div>
                        )}
                      </div>

                      {/* Status */}
                      <div className="space-y-2">
                        <p className="text-[10px] font-bold uppercase tracking-wider text-modern-secondary px-1">Status da Planilha</p>
                        <select 
                          value={statusFilter}
                          onChange={(e) => setStatusFilter(e.target.value)}
                          className="w-full bg-white border border-modern-border rounded-none px-3 py-2 text-[11px] font-bold text-modern-text focus:outline-none"
                        >
                          <option value="all">Todos os Status</option>
                          {uniqueStatuses.map(status => (
                            <option key={status} value={status}>{status}</option>
                          ))}
                        </select>
                      </div>

                      {/* Tags/Ações */}
                      <div className="space-y-2">
                        <p className="text-[10px] font-bold uppercase tracking-wider text-modern-secondary px-1">Ações / Tags</p>
                        <div className="grid grid-cols-2 gap-2">
                          {[
                            { id: 'all', label: 'Todas' },
                            { id: 'reloginho', label: 'Reloginho' },
                            { id: 'contato_sucesso', label: 'Sucesso' },
                            { id: 'contato_falha', label: 'Falha' },
                            { id: 'vendido', label: 'Vendido' },
                            { id: 'lixo', label: 'Lixo' }
                          ].map((item) => (
                            <button
                              key={item.id}
                              onClick={() => setTagFilter(item.id)}
                              className={cn(
                                "text-left px-3 py-2 rounded-none text-[11px] font-bold transition-colors border",
                                tagFilter === item.id 
                                  ? "bg-modern-primary/10 border-modern-primary/20 text-modern-primary" 
                                  : "bg-white border-modern-border text-modern-text hover:bg-slate-50"
                              )}
                            >
                              {item.label}
                            </button>
                          ))}
                        </div>
                      </div>

                      <button 
                        onClick={() => setShowFilterMenu(false)}
                        className="w-full bg-modern-text text-white py-2.5 font-bold text-[11px] hover:bg-modern-text/90 transition-all"
                      >
                        Fechar Filtros
                      </button>
                    </motion.div>
                  </>
                )}
              </AnimatePresence>
            </div>

          <div className="flex-1" />
          <p className="text-xs font-bold text-modern-secondary bg-white px-4 py-2 rounded-none border border-modern-border shadow-sm">
            {filteredClients.length} resultados
          </p>
        </div>

        {/* Spreadsheet Area */}
        <div className="flex-1 overflow-hidden px-10 pb-10 flex flex-col">
          <div className="bg-white rounded-none border border-modern-border shadow-sm overflow-hidden flex flex-col flex-1">
            <div 
              ref={tableContainerRef}
              onScroll={handleScroll}
              className="overflow-auto custom-scrollbar flex-1"
            >
              <table className="w-full text-left border-separate border-spacing-0 bg-white">
                <thead>
                  <tr className="bg-[#f8f9fa]">
                    <th className="sticky top-0 z-20 px-2 py-2 text-[11px] font-medium text-[#5f6368] text-center border-b border-r border-[#dadce0] bg-[#f8f9fa] w-16">Linha</th>
                    <th className="sticky top-0 z-20 px-3 py-2 text-[11px] font-medium text-[#5f6368] uppercase tracking-wider border-b border-r border-[#dadce0] bg-[#f8f9fa] text-center">Ações</th>
                    <th className="sticky top-0 z-20 px-3 py-2 text-[11px] font-medium text-[#5f6368] uppercase tracking-wider border-b border-r border-[#dadce0] bg-[#f8f9fa] text-center w-12">Zap</th>
                    <th className="sticky top-0 z-20 px-3 py-2 text-[11px] font-medium text-[#5f6368] uppercase tracking-wider border-b border-r border-[#dadce0] bg-[#f8f9fa]">Cliente</th>
                    <th className="sticky top-0 z-20 px-3 py-2 text-[11px] font-medium text-[#5f6368] uppercase tracking-wider border-b border-r border-[#dadce0] bg-[#f8f9fa]">WhatsApp / Telefone</th>
                    <th className="sticky top-0 z-20 px-3 py-2 text-[11px] font-medium text-[#5f6368] uppercase tracking-wider border-b border-r border-[#dadce0] bg-[#f8f9fa]">E-mail</th>
                    <th className="sticky top-0 z-20 px-3 py-2 text-[11px] font-medium text-[#5f6368] uppercase tracking-wider border-b border-r border-[#dadce0] bg-[#f8f9fa]">Data/Hora</th>
                    <th className="sticky top-0 z-20 px-3 py-2 text-[11px] font-medium text-[#5f6368] uppercase tracking-wider border-b border-r border-[#dadce0] bg-[#f8f9fa]">Status Atual</th>
                    <th className="sticky top-0 z-20 px-3 py-2 text-[11px] font-medium text-[#5f6368] uppercase tracking-wider border-b border-[#dadce0] bg-[#f8f9fa]">Produto</th>
                  </tr>
                </thead>
                <tbody className="bg-white">
                  {loading ? (
                    Array.from({ length: 20 }).map((_, i) => (
                      <tr key={i} className="animate-pulse">
                        <td colSpan={8} className="px-3 py-2 h-10 border-b border-[#dadce0]" />
                      </tr>
                    ))
                  ) : pagedClients.map((client, idx) => {
                    if (!client) return null;
                    const clientKey = client.key;
                    const manualTag = clientTags[clientKey];
                    const currentTag = getClientTag(client);
                    
                    const lastLead = client.leads[0]; // Leads are sorted by timestamp desc
                    const assignedAcc = whatsappAccounts.find(a => a.id === client.assignedWhatsappId);

                    return (
                      <motion.tr 
                        key={clientKey}
                        onClick={() => setSelectedClient(client)}
                        className="group transition-colors cursor-pointer hover:bg-[#f1f3f4] relative hover:z-[200]"
                        initial={false}
                        animate={{ opacity: 1 }}
                      >
                        <td className="px-2 py-2 border-b border-r border-[#dadce0] bg-[#f8f9fa] text-center text-[10px] text-[#5f6368] font-medium">
                          {lastLead?.rowNumber || '-'}
                        </td>
                        <td className="px-3 py-2 border-b border-r border-[#dadce0]">
                          <div className="flex items-center justify-center gap-2" onClick={(e) => e.stopPropagation()}>
                            {client.telefone && (
                              <button 
                                onClick={() => copyToClipboard(`${client.nome} - ${client.telefone}`)}
                                className="w-6 h-6 rounded-none flex items-center justify-center transition-all border bg-white border-[#dadce0] text-[#5f6368] hover:bg-slate-50"
                                title="Copiar Nome + Tel"
                              >
                                <Copy size={12} />
                              </button>
                            )}
                            <button 
                              onClick={() => toggleTag(clientKey, 'reloginho')}
                              className={cn(
                                "w-6 h-6 rounded-none flex items-center justify-center transition-all border",
                                currentTag === 'reloginho' 
                                  ? "bg-amber-100 border-amber-200 text-amber-600" 
                                  : "bg-white border-[#dadce0] text-[#5f6368] hover:bg-slate-50"
                              )}
                              title="Pendente (Follow-up)"
                            >
                              <Clock size={12} />
                            </button>
                            
                            {/* Hover Menu for action tags */}
                            <div className="relative group/tagmenu" onClick={(e) => e.stopPropagation()}>
                              <button 
                                className={cn(
                                  "w-6 h-6 rounded-none flex items-center justify-center transition-all border",
                                  ['contato_sucesso', 'contato_falha', 'vendido'].includes(currentTag as string)
                                    ? "bg-modern-primary border-modern-primary text-white" 
                                    : "bg-white border-[#dadce0] text-[#5f6368] hover:bg-slate-50"
                                )}
                              >
                                <Plus size={12} />
                              </button>
                              
                              <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 hidden group-hover/tagmenu:flex bg-white border border-modern-border shadow-xl z-50 p-1 gap-1">
                                <button 
                                  onClick={(e) => { e.stopPropagation(); toggleTag(clientKey, 'contato_sucesso'); }}
                                  className={cn(
                                    "w-8 h-8 flex items-center justify-center transition-all border",
                                    currentTag === 'contato_sucesso' 
                                      ? "bg-emerald-100 border-emerald-200 text-emerald-600" 
                                      : "bg-white border-slate-200 text-slate-500 hover:bg-slate-50"
                                  )}
                                  title="Contato Bem Sucedido"
                                >
                                  <UserCheck size={14} />
                                </button>
                                <button 
                                  onClick={(e) => { e.stopPropagation(); toggleTag(clientKey, 'contato_falha'); }}
                                  className={cn(
                                    "w-8 h-8 flex items-center justify-center transition-all border",
                                    currentTag === 'contato_falha' 
                                      ? "bg-gray-100 border-gray-300 text-gray-800" 
                                      : "bg-white border-slate-200 text-slate-500 hover:bg-slate-50"
                                  )}
                                  title="Contato Mal Sucedido"
                                >
                                  <UserX size={14} />
                                </button>
                                <button 
                                  onClick={(e) => { e.stopPropagation(); toggleTag(clientKey, 'vendido'); }}
                                  className={cn(
                                    "w-8 h-8 flex items-center justify-center transition-all border",
                                    currentTag === 'vendido' 
                                      ? "bg-emerald-500 border-emerald-600 text-white" 
                                      : "bg-white border-slate-200 text-slate-500 hover:bg-slate-50"
                                  )}
                                  title="Vendido"
                                >
                                  <CheckCircle2 size={14} />
                                </button>
                              </div>
                            </div>
                            <button 
                              onClick={() => toggleTag(clientKey, 'lixo')}
                              className={cn(
                                "w-6 h-6 rounded-none flex items-center justify-center transition-all border",
                                currentTag === 'lixo' 
                                  ? "bg-rose-100 border-rose-200 text-rose-600" 
                                  : "bg-white border-[#dadce0] text-[#5f6368] hover:bg-slate-50"
                              )}
                              title="Lixo (Número Inválido)"
                            >
                              <Trash2 size={12} />
                            </button>
                          </div>
                        </td>
                        <td className="px-3 py-2 border-b border-r border-[#dadce0] overflow-visible">
                          <div className="flex items-center justify-center">
                            <div className="relative group/zap" onClick={(e) => e.stopPropagation()}>
                              <button 
                                onClick={(e) => e.stopPropagation()}
                                className={cn(
                                  "w-7 h-7 rounded-none flex items-center justify-center transition-all border shadow-sm",
                                  (client.assignedWhatsappId && assignedAcc)
                                    ? "text-white" 
                                    : "bg-white border-[#dadce0] text-[#5f6368] hover:border-emerald-500 hover:text-emerald-500"
                                )}
                                style={(client.assignedWhatsappId && assignedAcc) ? { backgroundColor: assignedAcc.color } : {}}
                              >
                                {(client.assignedWhatsappId && assignedAcc) ? (
                                  <span className="text-[11px] font-black">{assignedAcc.identifier}</span>
                                ) : (
                                  <Phone size={14} />
                                )}
                              </button>
                              
                              <div className={cn(
                                "absolute left-1/2 -translate-x-1/2 w-64 bg-white border border-modern-border shadow-[0_12px_40px_rgba(0,0,0,0.3)] opacity-0 invisible group-hover/zap:opacity-100 group-hover/zap:visible transition-all z-[300] rounded-none",
                                idx < 10 ? "top-full mt-2" : "bottom-full mb-2"
                              )}>
                                <div className="p-3 border-b border-modern-border bg-slate-50 flex items-center justify-between">
                                  <p className="text-[10px] font-black uppercase text-modern-secondary tracking-widest text-left">Atribuir WhatsApp</p>
                                  <Phone size={12} className="text-modern-secondary" />
                                </div>
                                <div className="max-h-[350px] overflow-y-auto custom-scrollbar">
                                  {client.assignedWhatsappId && (
                                    <button 
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        updateClientExtra(clientKey, { assignedWhatsappId: "" });
                                      }}
                                      className="w-full text-left px-3 py-3 text-[10px] font-bold hover:bg-rose-50 flex items-center gap-2 border-b border-modern-border/30 text-rose-600 uppercase tracking-tighter transition-colors"
                                    >
                                      <div className="w-5 h-5 flex items-center justify-center bg-rose-100 text-rose-600 shrink-0">
                                        <X size={12} />
                                      </div>
                                      Remover Atribuição
                                    </button>
                                  )}
                                  {whatsappAccounts.map(acc => (
                                    <button 
                                      key={acc.id}
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        updateClientExtra(clientKey, { assignedWhatsappId: acc.id });
                                      }}
                                      className={cn(
                                        "w-full text-left px-3 py-2 text-[10px] font-bold hover:bg-slate-50 flex items-center gap-3 border-b border-modern-border/30 group/item transition-colors",
                                        client.assignedWhatsappId === acc.id && "bg-emerald-50/50"
                                      )}
                                    >
                                      <div className="w-6 h-6 flex items-center justify-center text-[10px] font-black text-white shrink-0 shadow-sm" style={{ backgroundColor: acc.color }}>
                                        {acc.identifier}
                                      </div>
                                      <div className="flex flex-col min-w-0">
                                        <span className="truncate text-modern-text leading-none mb-1">{acc.name}</span>
                                        <span className="text-[8px] uppercase text-modern-secondary tracking-widest leading-none opacity-60">{acc.origin}</span>
                                      </div>
                                    </button>
                                  ))}
                                  {whatsappAccounts.length === 0 && (
                                    <div className="px-4 py-8 text-[10px] text-modern-secondary text-center italic font-bold bg-slate-50/50 uppercase tracking-widest">
                                      Nenhum Zap cadastrado.
                                    </div>
                                  )}
                                </div>
                                <div className="p-2 border-t border-modern-border bg-slate-50">
                                  <button 
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setShowWhatsappManager(true);
                                    }}
                                    className="w-full py-2 text-[9px] font-black uppercase text-modern-primary hover:text-modern-text transition-colors text-center"
                                  >
                                    Configurar Contas
                                  </button>
                                </div>
                              </div>
                            </div>
                          </div>
                        </td>
                        <td className="px-3 py-2 border-b border-r border-[#dadce0]">
                          <div className="flex items-center gap-2">
                            <div className="w-6 h-6 rounded-none bg-modern-primary/10 flex items-center justify-center text-modern-primary font-bold text-[10px] shrink-0">
                              {client.nome.charAt(0)}
                            </div>
                            <div className="min-w-0 flex-1">
                              <p className="text-sm font-normal text-[#202124] truncate">{client.nome}</p>
                            </div>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                copyToClipboard(client.nome);
                              }}
                              className="opacity-0 group-hover:opacity-100 p-1 hover:bg-gray-200 rounded-none transition-all text-[#5f6368]"
                              title="Copiar nome"
                            >
                              <Copy size={12} />
                            </button>
                          </div>
                        </td>
                        <td className="px-3 py-2 border-b border-r border-[#dadce0]">
                          <div className="flex items-center justify-between group/phone">
                            <p className="text-sm font-normal text-[#3c4043] flex items-center gap-2">
                              <Phone size={12} className="text-[#5f6368]" /> {client.telefone || <span className="text-rose-400 italic text-[10px]">Sem número</span>}
                            </p>
                            {client.telefone && (
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  copyToClipboard(client.telefone);
                                }}
                                className="opacity-0 group-hover/phone:opacity-100 p-1 hover:bg-gray-200 rounded-none transition-all text-[#5f6368]"
                                title="Copiar telefone"
                              >
                                <Copy size={12} />
                              </button>
                            )}
                          </div>
                        </td>
                        <td className="px-3 py-2 border-b border-r border-[#dadce0]">
                          <p className="text-sm font-normal text-[#5f6368] truncate max-w-[180px]">
                            {client.email}
                          </p>
                        </td>
                        <td className="px-3 py-2 border-b border-r border-[#dadce0]">
                          <div className="flex flex-col">
                            <p className="text-sm font-normal text-[#202124]">{lastLead?.data}</p>
                            <p className="text-[10px] text-[#5f6368]">{lastLead?.hora}</p>
                          </div>
                        </td>
                        <td className="px-3 py-2 border-b border-r border-[#dadce0]">
                          <div className="flex items-center gap-2">
                            <div className={cn(
                              "px-1.5 py-0.5 rounded-none text-[10px] font-medium uppercase tracking-wider",
                              STATUS_THEMES[client.status]?.bg || "bg-slate-100",
                              STATUS_THEMES[client.status]?.text || "text-slate-500"
                            )}>
                              {client.status}
                            </div>
                            <div className={cn(
                              "px-2 py-0.5 rounded-none text-[9px] font-black uppercase shadow-sm flex items-center justify-center",
                              !currentTag ? "bg-[#DBEAFE] text-blue-700" :
                              (currentTag === 'pendente' || currentTag === 'reloginho') ? "bg-[#FEF3C6] text-amber-700" : 
                              (currentTag === 'vendido' || currentTag === 'contato_sucesso') ? "bg-[#D0FBE5] text-emerald-700" :
                              currentTag === 'contato_falha' ? "bg-gray-100 text-gray-700" :
                              currentTag === 'lixo' ? "bg-[#FFE3E6] text-rose-700" :
                              "bg-slate-100 text-slate-600"
                            )}>
                              {!currentTag ? 'Enviar Msg' : 
                               (currentTag === 'pendente' || currentTag === 'reloginho') ? 'Pendente' : 
                               (currentTag === 'vendido' || currentTag === 'contato_sucesso') ? 'Sucesso' : 
                               currentTag === 'contato_falha' ? 'C. Falha' :
                               currentTag === 'lixo' ? 'Lixo' :
                               'Status'}
                            </div>
                            {lastLead?.tags && (
                              <div className="px-1.5 py-0.5 rounded-none bg-slate-800 text-white text-[8px] font-black uppercase tracking-tighter shadow-sm">
                                {lastLead.tags}
                              </div>
                            )}
                          </div>
                        </td>
                        <td className="px-3 py-2 border-b border-[#dadce0]">
                          <div className="flex flex-col">
                            <p className="text-sm font-semibold text-[#202124] truncate max-w-[200px]">
                              {lastLead?.produto || '-'}
                            </p>
                          </div>
                        </td>
                      </motion.tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </>
    ) : (
      <div className="flex-1 overflow-y-auto p-10 space-y-10 custom-scrollbar">
          {/* Dashboard Header Stats */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8">
            <div className="bg-white border border-modern-border p-10 shadow-sm">
              <div className="flex items-center gap-4 mb-6">
                <div className="w-12 h-12 bg-modern-primary flex items-center justify-center text-white">
                  <TrendingUp size={24} />
                </div>
                <p className="text-[11px] font-extrabold uppercase tracking-widest text-modern-secondary">Comissão (Mês Atual)</p>
              </div>
              <p className="text-4xl font-extrabold text-modern-primary">
                {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(stats.currentMonthCommission)}
              </p>
            </div>
            
            <div className="bg-white border border-modern-border p-10 shadow-sm">
              <div className="flex items-center gap-4 mb-6">
                <div className="w-12 h-12 bg-emerald-100 flex items-center justify-center text-emerald-600">
                  <DollarSign size={24} />
                </div>
                <p className="text-[11px] font-extrabold uppercase tracking-widest text-modern-secondary">Comissão Total</p>
              </div>
              <p className="text-4xl font-extrabold text-modern-text">
                {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(stats.totalCommission)}
              </p>
            </div>

            <div className="bg-white border border-modern-border p-10 shadow-sm">
              <div className="flex items-center gap-4 mb-6">
                <div className="w-12 h-12 bg-blue-100 flex items-center justify-center text-blue-600">
                  <Package size={24} />
                </div>
                <p className="text-[11px] font-extrabold uppercase tracking-widest text-modern-secondary">Total de Vendas</p>
              </div>
              <p className="text-4xl font-extrabold text-modern-text">{manualSales.length}</p>
            </div>

            <div className="bg-white border border-modern-border p-10 shadow-sm">
              <div className="flex items-center gap-4 mb-6">
                <div className="w-12 h-12 bg-slate-100 flex items-center justify-center text-slate-600">
                  <Users size={24} />
                </div>
                <p className="text-[11px] font-extrabold uppercase tracking-widest text-modern-secondary">Clientes Atendidos</p>
              </div>
              <p className="text-4xl font-extrabold text-modern-text">{new Set(manualSales.map(s => s.clientKey)).size}</p>
            </div>
          </div>

          {/* Charts Row */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-10">
            <div className="bg-white border border-modern-border p-10 shadow-sm">
              <h3 className="text-xs font-extrabold uppercase tracking-widest text-modern-text mb-10">Evolução de Comissão Diária</h3>
              <div className="h-[350px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={dashboardData}>
                    <defs>
                      <linearGradient id="colorComm" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#00BAB1" stopOpacity={0.1}/>
                        <stop offset="95%" stopColor="#00BAB1" stopOpacity={0}/>
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                    <XAxis 
                      dataKey="date" 
                      axisLine={false} 
                      tickLine={false} 
                      tick={{ fontSize: 11, fontWeight: 700, fill: '#64748b' }}
                      tickFormatter={(val) => {
                        const [year, month, day] = val.split('-');
                        return `${day}/${month}`;
                      }}
                    />
                    <YAxis 
                      axisLine={false} 
                      tickLine={false} 
                      tick={{ fontSize: 11, fontWeight: 700, fill: '#64748b' }}
                      tickFormatter={(val) => `R$ ${val}`}
                    />
                    <Tooltip 
                      contentStyle={{ borderRadius: '0px', border: '1px solid #e2e8f0', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)' }}
                      labelStyle={{ fontWeight: 800, fontSize: '13px', marginBottom: '6px' }}
                    />
                    <Area type="monotone" dataKey="commission" stroke="#00BAB1" strokeWidth={4} fillOpacity={1} fill="url(#colorComm)" />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div className="bg-white border border-modern-border p-10 shadow-sm">
              <h3 className="text-xs font-extrabold uppercase tracking-widest text-modern-text mb-10">Volume de Vendas Diário</h3>
              <div className="h-[350px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={dashboardData}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                    <XAxis 
                      dataKey="date" 
                      axisLine={false} 
                      tickLine={false} 
                      tick={{ fontSize: 11, fontWeight: 700, fill: '#64748b' }}
                      tickFormatter={(val) => {
                        const [year, month, day] = val.split('-');
                        return `${day}/${month}`;
                      }}
                    />
                    <YAxis 
                      axisLine={false} 
                      tickLine={false} 
                      tick={{ fontSize: 11, fontWeight: 700, fill: '#64748b' }}
                    />
                    <Tooltip 
                      contentStyle={{ borderRadius: '0px', border: '1px solid #e2e8f0', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)' }}
                    />
                    <Bar dataKey="count" fill="#3b82f6" radius={[0, 0, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>

          {/* WhatsApp Analytics Row */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-10">
            <div className="bg-white border border-modern-border p-10 shadow-sm">
              <h3 className="text-xs font-extrabold uppercase tracking-widest text-modern-text mb-10">Distribuição de Contatos por WhatsApp</h3>
              <div className="h-[350px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={whatsappStats.distributionData}
                      cx="50%"
                      cy="50%"
                      innerRadius={80}
                      outerRadius={120}
                      paddingAngle={5}
                      dataKey="value"
                    >
                      {whatsappStats.distributionData.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={entry.color} />
                      ))}
                    </Pie>
                    <Tooltip 
                      contentStyle={{ borderRadius: '0px', border: '1px solid #e2e8f0', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)' }}
                      formatter={(value: number) => [`${value} contatos`, 'Total']}
                    />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <div className="mt-6 flex flex-wrap gap-4 justify-center">
                {whatsappStats.distributionData.map((entry, index) => (
                  <div key={index} className="flex items-center gap-2">
                    <div className="w-3 h-3" style={{ backgroundColor: entry.color }} />
                    <span className="text-[9px] font-bold text-modern-secondary uppercase tracking-tight">{entry.name}: {entry.value}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="bg-white border border-modern-border p-10 shadow-sm">
              <h3 className="text-xs font-extrabold uppercase tracking-widest text-modern-text mb-10">Conversão Manual / WhatsApp (Faturamento)</h3>
              <div className="h-[350px] w-full">
                {whatsappStats.salesData.some(s => s.value > 0) ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={whatsappStats.salesData} layout="vertical" margin={{ left: 20 }}>
                      <CartesianGrid strokeDasharray="3 3" horizontal={true} vertical={false} stroke="#f1f5f9" />
                      <XAxis type="number" axisLine={false} tickLine={false} tick={{ fontSize: 10, fontBold: 700, fill: '#64748b' }} tickFormatter={(val) => `R$ ${val}`} />
                      <YAxis dataKey="name" type="category" axisLine={false} tickLine={false} tick={{ fontSize: 10, fontWeight: 700, fill: '#64748b' }} width={120} />
                      <Tooltip 
                        contentStyle={{ borderRadius: '0px', border: '1px solid #e2e8f0', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)' }}
                        formatter={(value: number) => [new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value), 'Faturamento']}
                      />
                      <Bar dataKey="value" radius={[0, 4, 4, 0]}>
                        {whatsappStats.salesData.map((entry, index) => (
                          <Cell key={`cell-${index}`} fill={entry.color} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="h-full flex flex-col items-center justify-center text-center space-y-3">
                    <div className="w-16 h-16 bg-slate-50 flex items-center justify-center rounded-none text-slate-300">
                      <DollarSign size={32} />
                    </div>
                    <p className="text-[11px] font-bold text-modern-secondary uppercase tracking-widest px-10">Aguardando as primeiras conversões manuais para gerar o gráfico</p>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Hourly and Daily Analytics Row */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-10">
            <div className="bg-white border border-modern-border p-10 shadow-sm">
              <h3 className="text-xs font-extrabold uppercase tracking-widest text-modern-text mb-10 flex items-center gap-2">
                <Clock size={14} className="text-emerald-600" />
                Vendas por Horário (Pico)
              </h3>
              <div className="h-[300px] w-full">
                {manualSales.length > 0 ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={whatsappStats.hourlyDistribution}>
                      <defs>
                        <linearGradient id="colorHour" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#10b981" stopOpacity={0.3}/>
                          <stop offset="95%" stopColor="#10b981" stopOpacity={0}/>
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                      <XAxis 
                        dataKey="label" 
                        axisLine={false} 
                        tickLine={false} 
                        tick={{ fontSize: 9, fontWeight: 700, fill: '#64748b' }} 
                      />
                      <YAxis 
                        axisLine={false} 
                        tickLine={false} 
                        tick={{ fontSize: 10, fontWeight: 700, fill: '#64748b' }} 
                      />
                      <Tooltip 
                        contentStyle={{ borderRadius: '0px', border: '1px solid #e2e8f0', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)' }}
                        formatter={(value: number) => [value, 'Vendas']}
                      />
                      <Area type="monotone" dataKey="count" stroke="#10b981" strokeWidth={3} fillOpacity={1} fill="url(#colorHour)" />
                    </AreaChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="h-full flex items-center justify-center text-center">
                    <p className="text-[11px] font-bold text-modern-secondary uppercase tracking-widest">Sem vendas registradas para análise horária</p>
                  </div>
                )}
              </div>
            </div>

            <div className="bg-white border border-modern-border p-10 shadow-sm">
              <h3 className="text-xs font-extrabold uppercase tracking-widest text-modern-text mb-10 flex items-center gap-2">
                <Calendar size={14} className="text-blue-600" />
                Vendas por Dia da Semana
              </h3>
              <div className="h-[300px] w-full">
                {manualSales.length > 0 ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={whatsappStats.dailyDistribution}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                      <XAxis 
                        dataKey="day" 
                        axisLine={false} 
                        tickLine={false} 
                        tick={{ fontSize: 9, fontWeight: 700, fill: '#64748b' }} 
                      />
                      <YAxis 
                        axisLine={false} 
                        tickLine={false} 
                        tick={{ fontSize: 10, fontWeight: 700, fill: '#64748b' }} 
                      />
                      <Tooltip 
                        contentStyle={{ borderRadius: '0px', border: '1px solid #e2e8f0', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)' }}
                        formatter={(value: number) => [`R$ ${value.toFixed(2)}`, 'Faturamento']}
                      />
                      <Bar dataKey="value" fill="#3b82f6" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="h-full flex items-center justify-center text-center">
                    <p className="text-[11px] font-bold text-modern-secondary uppercase tracking-widest">Sem vendas registradas para análise diária</p>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Monthly Commission Table */}
          <div className="bg-white border border-modern-border p-10 shadow-sm">
            <div className="flex items-center justify-between mb-10">
              <h3 className="text-xs font-extrabold uppercase tracking-widest text-modern-text">Resumo de Comissão por Mês</h3>
              <div className="flex items-center gap-2 text-emerald-600">
                <Calendar size={16} />
                <span className="text-[10px] font-bold uppercase tracking-wider">Histórico Mensal</span>
              </div>
            </div>
            
            <div className="overflow-x-auto">
              <table className="w-full text-left border-separate border-spacing-0">
                <thead>
                  <tr>
                    <th className="px-6 py-4 text-[10px] font-extrabold uppercase tracking-widest text-modern-secondary border-b border-modern-border">Mês</th>
                    <th className="px-6 py-4 text-[10px] font-extrabold uppercase tracking-widest text-modern-secondary border-b border-modern-border text-center">Vendas</th>
                    <th className="px-6 py-4 text-[10px] font-extrabold uppercase tracking-widest text-modern-secondary border-b border-modern-border text-right">Faturamento</th>
                    <th className="px-6 py-4 text-[10px] font-extrabold uppercase tracking-widest text-modern-secondary border-b border-modern-border text-right">Comissão</th>
                  </tr>
                </thead>
                <tbody>
                  {monthlyData.length > 0 ? (
                    monthlyData.map((data) => (
                      <tr key={data.month} className="hover:bg-slate-50 transition-colors">
                        <td className="px-6 py-5 text-sm font-bold text-modern-text border-b border-modern-border capitalize">
                          {data.monthName}
                        </td>
                        <td className="px-6 py-5 text-sm font-bold text-modern-secondary border-b border-modern-border text-center">
                          {data.count}
                        </td>
                        <td className="px-6 py-5 text-sm font-bold text-modern-text border-b border-modern-border text-right">
                          {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(data.value)}
                        </td>
                        <td className="px-6 py-5 text-sm font-extrabold text-emerald-600 border-b border-modern-border text-right">
                          {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(data.commission)}
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={4} className="px-6 py-10 text-center text-[11px] font-bold text-modern-secondary uppercase tracking-wider border-b border-modern-border">
                        Nenhuma venda registrada para gerar o histórico mensal
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Recent Sales Table */}
          <div className="bg-white border border-modern-border shadow-sm overflow-hidden">
            <div className="p-8 border-b border-modern-border bg-slate-50/50 flex items-center justify-between">
              <h3 className="text-xs font-extrabold uppercase tracking-widest text-modern-text">Histórico de Vendas Manuais</h3>
              
              <div className="flex items-center gap-3">
                <span className="text-[10px] font-bold uppercase tracking-widest text-modern-secondary">{showUtms ? 'Ver Comissões' : 'Ver UTMs'}</span>
                <button 
                  onClick={() => setShowUtms(!showUtms)}
                  className={cn(
                    "w-10 h-5 rounded-full relative transition-colors duration-200 focus:outline-none",
                    showUtms ? "bg-modern-primary" : "bg-slate-200"
                  )}
                >
                  <motion.div 
                    animate={{ x: showUtms ? 20 : 2 }}
                    className="absolute top-1 left-0 w-3 h-3 bg-white rounded-full shadow-sm"
                    transition={{ type: "spring", stiffness: 500, damping: 30 }}
                  />
                </button>
              </div>
            </div>

            <div 
              ref={salesTableRef}
              className={cn(
                "overflow-auto custom-scrollbar relative border border-modern-border",
                showUtms ? "max-h-[750px] shadow-sm" : ""
              )}
            >
              <table className="w-full text-left border-separate border-spacing-0 min-w-full">
                <thead>
                  <tr className="bg-white">
                    <th className="py-5 text-[11px] font-extrabold text-modern-secondary uppercase tracking-widest bg-white sticky left-0 z-50 border-b border-modern-border whitespace-nowrap px-4 border-r border-slate-100 top-0 w-[120px] min-w-[120px]">Data</th>
                    <th className="py-5 text-[11px] font-extrabold text-modern-secondary uppercase tracking-widest bg-white sticky left-[120px] z-40 border-b border-modern-border whitespace-nowrap px-4 border-r border-slate-100 top-0 w-[200px] min-w-[200px]">Produto</th>
                    <th className="py-5 text-[11px] font-extrabold text-modern-secondary uppercase tracking-widest bg-white sticky left-[320px] z-40 border-b border-modern-border whitespace-nowrap px-4 border-r border-slate-100 top-0 w-[100px] min-w-[100px]">Valor</th>
                    <th className="py-5 text-[11px] font-extrabold text-modern-secondary uppercase tracking-widest bg-white sticky left-[420px] z-40 border-b border-modern-border whitespace-nowrap px-4 shadow-[2px_0_0_0_rgba(0,0,0,0.05)] top-0 w-[180px] min-w-[180px]">Cliente</th>
                    
                    {!showUtms ? (
                      <>
                        <th className="px-8 py-5 text-[11px] font-extrabold text-modern-secondary uppercase tracking-widest text-right border-b border-modern-border bg-white sticky top-0 z-30">Comissão</th>
                        <th className="px-4 py-5 border-b border-modern-border bg-white sticky top-0 z-30 w-[80px]"></th>
                      </>
                    ) : (
                      <>
                        <th className="px-6 py-5 text-[10px] font-extrabold text-modern-secondary uppercase tracking-tighter whitespace-nowrap border-b border-modern-border bg-white sticky top-0 z-30">Src</th>
                        <th className="px-6 py-5 text-[10px] font-extrabold text-modern-secondary uppercase tracking-tighter whitespace-nowrap border-b border-modern-border bg-white sticky top-0 z-30">Sck</th>
                        <th className="px-6 py-5 text-[10px] font-extrabold text-modern-secondary uppercase tracking-tighter whitespace-nowrap border-b border-modern-border bg-white sticky top-0 z-30">Source</th>
                        <th className="px-6 py-5 text-[10px] font-extrabold text-modern-secondary uppercase tracking-tighter whitespace-nowrap border-b border-modern-border bg-white sticky top-0 z-30">Medium</th>
                        <th className="px-6 py-5 text-[10px] font-extrabold text-modern-secondary uppercase tracking-tighter whitespace-nowrap border-b border-modern-border bg-white sticky top-0 z-30">Campaign</th>
                        <th className="px-6 py-5 text-[10px] font-extrabold text-modern-secondary uppercase tracking-tighter whitespace-nowrap border-b border-modern-border bg-white sticky top-0 z-30">Content</th>
                        <th className="px-6 py-5 text-[10px] font-extrabold text-modern-secondary uppercase tracking-tighter whitespace-nowrap border-b border-modern-border bg-white sticky top-0 z-30">Term</th>
                        <th className="px-6 py-5 text-[10px] font-extrabold text-modern-secondary uppercase tracking-tighter text-right whitespace-nowrap border-b border-modern-border bg-white sticky top-0 z-30">TTCID</th>
                      </>
                    )}
                  </tr>
                </thead>
                <tbody className="bg-white">
                  {manualSales.sort((a, b) => b.timestamp - a.timestamp).map(sale => {
                    const client = enrichedClients.find(c => c.key === sale.clientKey);
                    const lastLead = client?.leads[0];
                    
                    return (
                      <tr key={sale.id} className="hover:bg-slate-50 transition-colors group">
                        <td className="py-5 text-sm font-bold text-modern-text whitespace-nowrap bg-white sticky left-0 z-10 border-b border-modern-border group-hover:bg-slate-50 px-4 border-r border-slate-100 text-[11px] w-[120px] min-w-[120px]">
                          {(() => {
                            const [year, month, day] = sale.date.split('-');
                            return `${day}/${month}/${year}`;
                          })()}
                        </td>
                        <td className="py-5 text-sm font-medium text-modern-text whitespace-nowrap bg-white sticky left-[120px] z-10 border-b border-modern-border group-hover:bg-slate-50 px-4 border-r border-slate-100 text-[11px] w-[200px] min-w-[200px] truncate max-w-[200px]">{sale.productName}</td>
                        <td className="py-5 text-sm font-bold text-modern-text whitespace-nowrap bg-white sticky left-[320px] z-10 border-b border-modern-border group-hover:bg-slate-50 px-4 border-r border-slate-100 text-[11px] w-[100px] min-w-[100px]">
                          {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(sale.value)}
                        </td>
                        <td className="py-5 text-sm font-bold text-modern-text whitespace-nowrap bg-white sticky left-[420px] z-10 border-b border-modern-border group-hover:bg-slate-50 shadow-[2px_0_0_0_rgba(0,0,0,0.05)] truncate px-4 text-[11px] w-[180px] min-w-[180px] max-w-[180px]">
                          {client?.nome || 'N/A'}
                        </td>
                        
                        {!showUtms ? (
                          <>
                            <td className="px-8 py-5 text-sm font-extrabold text-emerald-600 text-right whitespace-nowrap border-b border-modern-border">
                              {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(sale.commission)}
                            </td>
                            <td className="px-4 py-5 whitespace-nowrap border-b border-modern-border text-right">
                              <div className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                <button 
                                  onClick={() => handleEditSale(sale)}
                                  className="p-2 text-modern-secondary hover:text-emerald-600 transition-colors"
                                  title="Editar"
                                >
                                  <Edit size={16} />
                                </button>
                                <button 
                                  onClick={() => handleDeleteSale(sale.id)}
                                  className="p-2 text-rose-400 hover:text-rose-600 transition-colors"
                                  title="Excluir"
                                >
                                  <Trash2 size={16} />
                                </button>
                              </div>
                            </td>
                          </>
                        ) : (
                          <>
                            <td className="px-6 py-5 text-[10px] font-medium text-modern-secondary whitespace-nowrap border-b border-modern-border">{lastLead?.src || '-'}</td>
                            <td className="px-6 py-5 text-[10px] font-medium text-modern-secondary whitespace-nowrap border-b border-modern-border">{lastLead?.sck || '-'}</td>
                            <td className="px-6 py-5 text-[10px] font-medium text-modern-secondary whitespace-nowrap border-b border-modern-border">{lastLead?.utm_source || '-'}</td>
                            <td className="px-6 py-5 text-[10px] font-medium text-modern-secondary whitespace-nowrap border-b border-modern-border">{lastLead?.utm_medium || '-'}</td>
                            <td className="px-6 py-5 text-[10px] font-medium text-modern-secondary whitespace-nowrap border-b border-modern-border">{lastLead?.utm_campaign || '-'}</td>
                            <td className="px-6 py-5 text-[10px] font-medium text-modern-secondary whitespace-nowrap border-b border-modern-border">{lastLead?.utm_content || '-'}</td>
                            <td className="px-6 py-5 text-[10px] font-medium text-modern-secondary whitespace-nowrap border-b border-modern-border">{lastLead?.utm_term || '-'}</td>
                            <td className="px-6 py-5 text-[10px] font-medium text-modern-secondary text-right whitespace-nowrap border-b border-modern-border">{lastLead?.ttcid || '-'}</td>
                          </>
                        )}
                      </tr>
                    );
                  })}
                  {manualSales.length === 0 && (
                    <tr>
                      <td colSpan={showUtms ? 12 : 5} className="px-8 py-20 text-center text-sm font-bold text-modern-secondary uppercase tracking-widest border-b border-modern-border">
                        Nenhuma venda registrada ainda
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  </main>

      {/* Detail Panel - Modern Style */}
      <AnimatePresence>
        {currentSelectedClient && (
          <>
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setSelectedClient(null)}
              className="fixed inset-0 z-40 bg-modern-text/20 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ x: '100%' }}
              animate={{ x: 0 }}
              exit={{ x: '100%' }}
              transition={{ type: 'spring', damping: 25, stiffness: 200 }}
              className="fixed right-0 top-0 h-full w-full max-w-xl bg-white shadow-2xl z-50 overflow-y-auto custom-scrollbar flex flex-col"
            >
              <div className="p-10">
                <div className="flex items-center justify-between mb-12">
                  <button 
                    onClick={() => setSelectedClient(null)}
                    className="w-12 h-12 bg-slate-100 rounded-none flex items-center justify-center text-modern-secondary hover:text-modern-text transition-colors"
                  >
                    <X size={24} />
                  </button>
                  <div className="text-right">
                    <p className="text-[10px] font-bold uppercase tracking-wider text-modern-secondary">Última Atividade</p>
                    <p className="text-xs font-bold text-modern-text">{currentSelectedClient.lastPurchaseDate}</p>
                  </div>
                </div>

                <div className="mb-12">
                  <h2 className="text-4xl font-extrabold tracking-tight text-modern-text mb-3 leading-tight">{currentSelectedClient.nome}</h2>
                  <div className="flex flex-wrap gap-4 text-xs font-bold text-modern-secondary mb-6">
                    <p className="flex items-center gap-2 bg-slate-50 px-3 py-1.5 rounded-none border border-modern-border"><AtSign size={14} /> {currentSelectedClient.email}</p>
                    <p className="flex items-center gap-2 bg-slate-50 px-3 py-1.5 rounded-none border border-modern-border"><Phone size={14} /> {currentSelectedClient.telefone}</p>
                  </div>
                  
                  <div className="space-y-4">
                    {/* Checkout Link */}
                    {currentSelectedClient.leads?.[0]?.checkoutUrl && (
                      <div className="flex items-center gap-3 bg-[#DBEAFE]/30 p-4 border border-blue-100">
                        <div className="w-8 h-8 bg-blue-600 flex items-center justify-center text-white shrink-0">
                          <ExternalLink size={16} />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-[10px] font-black uppercase text-blue-600 tracking-tighter">Checkout da Venda</p>
                          <p className="text-xs font-bold text-modern-text truncate">{currentSelectedClient.leads[0].checkoutUrl}</p>
                        </div>
                        <button 
                          onClick={() => copyToClipboard(currentSelectedClient.leads![0].checkoutUrl!)}
                          className="px-3 py-1.5 bg-white border border-blue-200 text-blue-600 text-[10px] font-black uppercase hover:bg-blue-50 transition-all shadow-sm flex items-center gap-1"
                        >
                          <Copy size={12} /> Copiar
                        </button>
                      </div>
                    )}

                    {/* Tracking Code */}
                    <div className="flex items-center gap-3 bg-slate-50 p-4 border border-modern-border">
                      <div className="w-8 h-8 bg-modern-text flex items-center justify-center text-white shrink-0">
                        <Package size={16} />
                      </div>
                      <div className="flex-1">
                        <p className="text-[10px] font-black uppercase text-modern-secondary tracking-tighter">Código de Rastreio</p>
                        <input 
                          type="text"
                          placeholder="Digite o código de rastreio..."
                          value={currentSelectedClient.trackingCode || ""}
                          onChange={(e) => updateClientExtra(currentSelectedClient.key, { trackingCode: e.target.value })}
                          className="w-full bg-transparent border-b border-modern-text/20 focus:border-modern-text focus:outline-none text-xs font-bold py-1 placeholder:text-modern-secondary/30"
                        />
                      </div>
                    </div>

                    {/* Payment Status */}
                    <div className="flex items-center gap-3 bg-slate-50 p-4 border border-modern-border">
                      <div className="w-8 h-8 bg-modern-text flex items-center justify-center text-white shrink-0">
                        <DollarSign size={16} />
                      </div>
                      <div className="flex-1">
                        <p className="text-[10px] font-black uppercase text-modern-secondary tracking-tighter mb-2">Status de Pagamento Enviado</p>
                        <div className="flex items-center gap-2">
                          {[
                            { id: 'link_enviado', label: 'Link de Pagamento', color: 'blue' },
                            { id: 'pix_enviado', label: 'Chave Pix', color: 'emerald' },
                            { id: 'boleto_enviado', label: 'Boleto Bancário', color: 'orange' }
                          ].map((ps) => (
                            <button
                              key={ps.id}
                              onClick={() => {
                                updatePaymentStatus(currentSelectedClient.key, paymentStatuses[currentSelectedClient.key]?.status === ps.id ? null : ps.id as any);
                              }}
                              className={cn(
                                "flex-1 px-3 py-2 text-[10px] font-black uppercase transition-all border",
                                paymentStatuses[currentSelectedClient.key]?.status === ps.id
                                  ? `bg-${ps.color}-600 border-${ps.color}-700 text-white shadow-sm`
                                  : `bg-white border-slate-200 text-slate-400 hover:border-${ps.color}-300 hover:bg-slate-50`
                              )}
                            >
                              {ps.label}
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Manual Sales Section */}
                <div className="mb-12 border-b border-modern-border pb-12">
                  <div className="flex items-center justify-between mb-8">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 bg-emerald-100 rounded-none flex items-center justify-center text-emerald-600">
                        <DollarSign size={18} />
                      </div>
                      <h4 className="text-xs font-extrabold uppercase tracking-[0.15em] text-modern-text">Vendas Diretas (WhatsApp)</h4>
                    </div>
                    <button 
                      onClick={() => setShowAddSaleModal(true)}
                      className="flex items-center gap-2 bg-emerald-600 text-white px-4 py-2 text-[11px] font-bold hover:bg-emerald-700 transition-all shadow-sm"
                    >
                      <Plus size={16} /> Registrar Venda
                    </button>
                  </div>

                  <div className="space-y-4">
                    {currentSelectedClient.manualSales && currentSelectedClient.manualSales.length > 0 ? (
                      [...currentSelectedClient.manualSales]
                        .sort((a, b) => b.timestamp - a.timestamp)
                        .map(sale => (
                          <div key={sale.id} className="bg-slate-50 border border-modern-border p-5 flex items-center justify-between group/sale">
                            <div>
                              <p className="text-sm font-bold text-modern-text">{sale.productName}</p>
                              <p className="text-[10px] font-bold text-modern-secondary uppercase tracking-wider">
                                {(() => {
                                  const [year, month, day] = sale.date.split('-');
                                  return `${day}/${month}/${year}`;
                                })()}
                              </p>
                            </div>
                            <div className="flex items-center gap-2">
                              <div className="text-right">
                                <p className="text-sm font-extrabold text-emerald-600">
                                  {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(sale.value)}
                                </p>
                                <p className="text-[9px] font-bold text-modern-secondary uppercase">
                                  {format(new Date(sale.timestamp), 'HH:mm')} • {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(sale.commission)}
                                </p>
                              </div>
                              <div className="flex flex-col opacity-0 group-hover/sale:opacity-100 transition-all">
                                <button 
                                  onClick={() => handleEditSale(sale)}
                                  className="p-1.5 text-modern-secondary hover:text-emerald-600 hover:bg-emerald-50 transition-all"
                                  title="Editar Venda"
                                >
                                  <Edit size={14} />
                                </button>
                                <button 
                                  onClick={() => handleDeleteSale(sale.id)}
                                  className="p-1.5 text-rose-400 hover:text-rose-600 hover:bg-rose-50 transition-all"
                                  title="Excluir Venda"
                                >
                                  <Trash2 size={14} />
                                </button>
                              </div>
                            </div>
                          </div>
                        ))
                    ) : (
                      <div className="text-center py-10 bg-slate-50 border border-dashed border-modern-border">
                        <p className="text-[11px] font-bold text-modern-secondary uppercase tracking-wider">Nenhuma venda manual registrada</p>
                      </div>
                    )}
                  </div>
                </div>

                {/* History Section */}
                <div className="flex-1">
                  <div className="space-y-8 mb-12">
                    {interactionLogs[currentSelectedClient.key] && (
                      <div className="space-y-4">
                        <p className="text-[10px] font-black uppercase text-modern-secondary tracking-widest border-b border-modern-border pb-2">Histórico de Interações</p>
                        {interactionLogs[currentSelectedClient.key].map(log => (
                          <div key={log.id} className="flex gap-4 items-start bg-emerald-50/30 p-4 border border-emerald-100">
                             <div className="w-6 h-6 bg-emerald-600 flex items-center justify-center shrink-0">
                                {log.type === 'tag_change' ? <AlertCircle size={12} className="text-white" /> : <Database size={12} className="text-white" />}
                             </div>
                             <div>
                               <p className="text-xs font-bold text-modern-text">{log.content}</p>
                               <p className="text-[9px] font-black text-emerald-600 uppercase mt-1">{format(new Date(log.timestamp), "dd/MM 'às' HH:mm", { locale: ptBR })}</p>
                             </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="flex items-center gap-3 mb-8">
                    <div className="w-8 h-8 bg-modern-primary/10 rounded-none flex items-center justify-center text-modern-primary">
                      <History size={18} />
                    </div>
                    <h4 className="text-xs font-extrabold uppercase tracking-[0.15em] text-modern-text">Histórico de Atividade</h4>
                  </div>

                  <div className="space-y-8">
                    {currentSelectedClient.leads.map((lead) => (
                      <div key={lead.id} className="modern-card p-8 border-none shadow-sm bg-slate-50/50">
                        <div className="flex justify-between items-start mb-6">
                          <div>
                            <p className="text-[10px] font-extrabold text-modern-secondary mb-2 flex items-center gap-2">
                              <Calendar size={12} /> {lead.data} • {lead.hora}
                            </p>
                            <h5 className="text-lg font-bold text-modern-text">{lead.produto}</h5>
                          </div>
                          <div className="text-right">
                            <p className="text-lg font-extrabold text-modern-primary mb-2">{lead.valor}</p>
                            <div className="flex flex-col items-end gap-2">
                              <span className={cn(
                                "text-[9px] font-extrabold uppercase tracking-widest px-2 py-1 rounded-none shadow-sm",
                                STATUS_THEMES[lead.status]?.bg || "bg-slate-100",
                                STATUS_THEMES[lead.status]?.text || "text-slate-500"
                              )}>
                                {lead.status}
                              </span>
                              {lead.paymentMethod && (
                                <span className="text-[8px] font-bold text-modern-secondary uppercase tracking-wider bg-white border border-modern-border px-2 py-0.5">
                                  {lead.paymentMethod}
                                </span>
                              )}
                            </div>
                          </div>
                        </div>

                        <div className="flex items-center gap-4">
                          <button 
                            onClick={() => handleGenerateMessage(lead)}
                            className="modern-button text-xs py-3 px-8"
                          >
                            Gerar Mensagem IA
                          </button>
                          <div className="flex-1" />
                          <p className="text-[10px] text-modern-secondary font-mono bg-white px-2 py-1 rounded-none border border-modern-border">ID: {lead.codPay}</p>
                        </div>

                        <AnimatePresence>
                          {generating && selectedLead?.id === lead.id && (
                            <motion.div 
                              initial={{ opacity: 0, height: 0 }}
                              animate={{ opacity: 1, height: 'auto' }}
                              className="mt-6 p-5 bg-modern-primary/5 rounded-none italic text-xs text-modern-primary font-medium border border-modern-primary/10"
                            >
                              Compondo abordagem personalizada com IA...
                            </motion.div>
                          )}
                          {generatedMessage && selectedLead?.id === lead.id && (
                            <motion.div 
                              initial={{ opacity: 0, height: 0 }}
                              animate={{ opacity: 1, height: 'auto' }}
                              className="mt-6 space-y-5"
                            >
                              <div className="relative">
                                <textarea 
                                  readOnly
                                  value={generatedMessage}
                                  className="w-full h-40 p-5 bg-white border border-modern-border rounded-none text-xs font-medium text-modern-text focus:outline-none resize-none leading-relaxed shadow-inner"
                                />
                                <button 
                                  onClick={() => copyToClipboard(generatedMessage)}
                                  className="absolute bottom-4 right-4 p-3 bg-white rounded-none shadow-lg border border-modern-border text-modern-secondary hover:text-modern-primary transition-all"
                                >
                                  {copied ? <CheckCircle2 size={16} className="text-emerald-500" /> : <Copy size={16} />}
                                </button>
                              </div>
                              <div className="flex gap-4">
                                <a 
                                  href={`https://wa.me/${currentSelectedClient.telefone.replace(/\D/g, '')}?text=${encodeURIComponent(generatedMessage)}`}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="modern-button flex-1 flex items-center justify-center gap-3"
                                >
                                  <ExternalLink size={16} /> Enviar WhatsApp
                                </a>
                                <button 
                                  onClick={() => {setGeneratedMessage(null); setSelectedLead(null);}}
                                  className="modern-button-secondary"
                                >
                                  Fechar
                                </button>
                              </div>
                            </motion.div>
                          )}
                        </AnimatePresence>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
      {/* Settings Modal */}
      <AnimatePresence>
        {showSettings && (
          <>
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowSettings(false)}
              className="fixed inset-0 z-[60] bg-modern-text/40 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-xl bg-white shadow-2xl z-[70] p-0 rounded-none border border-modern-border overflow-hidden"
            >
              <div className="flex items-center justify-between p-8 border-b border-modern-border">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 bg-modern-primary/10 flex items-center justify-center text-modern-primary">
                    <Settings size={18} />
                  </div>
                  <h3 className="text-lg font-bold text-modern-text uppercase tracking-widest">Configurações</h3>
                </div>
                <button onClick={() => setShowSettings(false)} className="text-modern-secondary hover:text-modern-text">
                  <X size={20} />
                </button>
              </div>

              {/* Tabs */}
              <div className="flex border-b border-modern-border">
                <button 
                  onClick={() => setActiveSettingsTab('general')}
                  className={cn(
                    "flex-1 py-4 text-[10px] font-black uppercase tracking-widest transition-all",
                    activeSettingsTab === 'general' ? "border-b-2 border-modern-primary text-modern-primary bg-slate-50" : "text-modern-secondary hover:bg-slate-50"
                  )}
                >
                  Sincronização & Login
                </button>
                <button 
                  onClick={() => setActiveSettingsTab('partners')}
                  className={cn(
                    "flex-1 py-4 text-[10px] font-black uppercase tracking-widest transition-all",
                    activeSettingsTab === 'partners' ? "border-b-2 border-modern-primary text-modern-primary bg-slate-50" : "text-modern-secondary hover:bg-slate-50"
                  )}
                >
                  Sócios & Domínio
                </button>
              </div>

              <div className="p-8 max-h-[70vh] overflow-y-auto custom-scrollbar">
                {activeSettingsTab === 'general' ? (
                  <div className="space-y-6">
                    <div className="p-4 bg-blue-50 border border-blue-100 text-blue-800 text-[10px] leading-relaxed uppercase font-bold">
                      <p className="mb-2 flex items-center gap-2"><Database size={12} /> Integração com Planilha:</p>
                      <ol className="list-decimal ml-4 space-y-1">
                        <li>Na sua planilha, vá em Extensões &gt; Apps Script.</li>
                        <li>Cole o código de sincronização.</li>
                        <li>Implante como App da Web (acesso: Qualquer pessoa).</li>
                        <li>Cole os URLs abaixo para receber leads e salvar vendas.</li>
                      </ol>
                    </div>

                    <div className="space-y-4">
                      <div className="space-y-2">
                        <label className="text-[10px] font-bold uppercase tracking-wider text-modern-secondary">URL do Webhook (Receber Leads)</label>
                        <input 
                          type="text" 
                          value={webhookUrl}
                          onChange={(e) => setWebhookUrl(e.target.value)}
                          placeholder="URL para receber dados da planilha"
                          className="w-full px-4 py-3 bg-slate-50 border border-modern-border rounded-none text-sm font-medium focus:outline-none focus:ring-2 focus:ring-modern-primary/20 transition-all"
                        />
                      </div>

                      <div className="space-y-2">
                        <label className="text-[10px] font-bold uppercase tracking-wider text-modern-secondary">URL de Sincronização (Exportar)</label>
                        <input 
                          type="text" 
                          value={sheetSyncUrl}
                          onChange={(e) => setSheetSyncUrl(e.target.value)}
                          placeholder="URL do Web App p/ atualizar sua planilha"
                          className="w-full px-4 py-3 bg-slate-50 border border-modern-border rounded-none text-sm font-medium focus:outline-none focus:ring-2 focus:ring-modern-primary/20 transition-all"
                        />
                      </div>
                    </div>

                    <div className="pt-6 border-t border-modern-border">
                      <label className="text-[10px] font-bold uppercase tracking-wider text-modern-secondary mb-4 block">Sincronização em Nuvem</label>
                      {user ? (
                        <div className="p-4 bg-slate-50 border border-modern-border flex items-center justify-between">
                          <div className="flex items-center gap-3">
                            {user.photoURL && <img src={user.photoURL} alt={user.displayName || ''} className="w-8 h-8 rounded-full" referrerPolicy="no-referrer" />}
                            <div>
                              <p className="text-xs font-bold text-modern-text">{user.displayName}</p>
                              <p className="text-[10px] text-emerald-600 font-bold uppercase tracking-tight">Login Ativo</p>
                            </div>
                          </div>
                          <button 
                            onClick={handleLogout}
                            className="text-[10px] font-bold uppercase tracking-wider text-rose-500 hover:underline"
                          >
                            Sair
                          </button>
                        </div>
                      ) : (
                        <button 
                          onClick={handleLogin}
                          className="w-full py-4 bg-modern-text text-white font-bold text-xs uppercase tracking-widest hover:bg-black transition-all flex items-center justify-center gap-3"
                        >
                          <Users size={18} /> Conectar Conta Google
                        </button>
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="space-y-8">
                    <div className="p-5 bg-emerald-50 border border-emerald-100 text-emerald-800 text-[10px] leading-relaxed uppercase font-bold">
                      <p className="mb-2 flex items-center gap-2 text-xs"><Key size={14}/> Acesso Automático por Domínio:</p>
                      <p className="normal-case font-medium opacity-80">Ative para que qualquer pessoa com o e-mail da sua empresa (@{user?.email?.split('@')[1]}) veja seus dados sem precisar de convite.</p>
                    </div>

                    {!user ? (
                      <div className="text-center py-10 bg-slate-50 border border-dashed border-modern-border">
                        <p className="text-[10px] font-bold text-modern-secondary uppercase tracking-widest">Faça login para gerenciar acessos</p>
                      </div>
                    ) : (
                      <>
                        {/* Domain Access Toggle */}
                        <div className="p-6 bg-slate-50 border border-modern-border flex items-center justify-between">
                          <div>
                            <p className="text-[10px] font-black uppercase text-modern-text tracking-widest mb-1">Liberar para Equipe @{user.email?.split('@')[1]}</p>
                            <p className="text-[9px] font-bold text-modern-secondary uppercase opacity-70">Qualquer um do seu domínio pode acessar</p>
                          </div>
                          <button 
                            onClick={() => toggleDomainAccess(!domainAccessEnabled)}
                            className={cn(
                              "w-12 h-6 rounded-full transition-all relative",
                              domainAccessEnabled ? "bg-emerald-500" : "bg-slate-300"
                            )}
                          >
                            <div className={cn(
                              "absolute top-1 w-4 h-4 bg-white shadow-sm transition-all",
                              domainAccessEnabled ? "left-7" : "left-1"
                            )} />
                          </button>
                        </div>

                        {/* SECTION: ACCESS KEY */}
                        <div className="space-y-4 pt-4 border-t border-modern-border">
                          <label className="text-[10px] font-black uppercase tracking-wider text-modern-secondary flex items-center justify-between">
                            Chave para Sócios Externos
                            {domainAccessEnabled && <span className="text-[8px] bg-emerald-100 text-emerald-700 px-2 py-0.5">Domínio Ativo</span>}
                          </label>
                          {myOwnWorkspaceKey ? (
                            <div className="flex items-center gap-2">
                              <div className="flex-1 bg-white border border-modern-border px-4 py-3 font-mono text-lg font-bold text-modern-text flex items-center justify-center tracking-widest">
                                {myOwnWorkspaceKey}
                              </div>
                              <button 
                                onClick={() => copyToClipboard(myOwnWorkspaceKey)}
                                className="p-4 bg-modern-text text-white hover:bg-black transition-all"
                                title="Copiar Chave"
                              >
                                <Copy size={18} />
                              </button>
                            </div>
                          ) : (
                            <button 
                              onClick={generateWorkspaceKey}
                              disabled={isGeneratingKey}
                              className="w-full py-4 border-2 border-dashed border-emerald-300 text-emerald-600 font-black text-[10px] uppercase tracking-widest hover:bg-emerald-50 transition-all flex items-center justify-center gap-3"
                            >
                              {isGeneratingKey ? "Gerando..." : <><Plus size={16} /> Abrir Workspace</>}
                            </button>
                          )}
                        </div>

                        {/* CONNECTION STATUS */}
                        <div className="space-y-4 pt-8 border-t border-modern-border">
                          <label className="text-[10px] font-black uppercase tracking-wider text-modern-secondary border-b border-modern-border pb-2 block">Status da Conexão</label>
                          
                          {partnerWorkspaceData || domainWorkspaceData ? (
                            <div className="p-5 bg-blue-50 border border-blue-200">
                              <div className="flex items-center justify-between">
                                <div className="flex items-center gap-3">
                                  <div className="w-8 h-8 bg-blue-600 flex items-center justify-center text-white">
                                    <Users size={14} />
                                  </div>
                                  <div>
                                    <p className="text-[10px] font-black text-blue-600 uppercase tracking-widest">Visualizando Dados de:</p>
                                    <p className="text-xs font-bold text-modern-text">{(partnerWorkspaceData || domainWorkspaceData)?.ownerEmail}</p>
                                  </div>
                                </div>
                                <button 
                                  onClick={disconnectWorkspace}
                                  className="text-[10px] font-black text-rose-500 uppercase hover:underline"
                                >
                                  Desconectar
                                </button>
                              </div>
                              <p className="text-[9px] mt-3 text-blue-700 font-medium px-1 italic">
                                {partnerWorkspaceData ? "Conectado via Chave Manual" : `Conectado via Domínio @${user?.email?.split('@')[1]}`}
                              </p>
                            </div>
                          ) : (
                            <div className="space-y-3">
                              <div className="flex gap-2">
                                <input 
                                  type="text" 
                                  value={accessKeyInput}
                                  onChange={(e) => setAccessKeyInput(e.target.value.toUpperCase())}
                                  placeholder="COLE A CHAVE DO SEU SÓCIO AQUI"
                                  className="flex-1 px-4 py-3 bg-slate-50 border border-modern-border rounded-none text-sm font-bold focus:outline-none tracking-widest"
                                />
                                <button 
                                  onClick={redeemAccessKey}
                                  disabled={isLinkingKey || !accessKeyInput}
                                  className="bg-modern-primary text-white px-6 py-3 font-bold text-xs uppercase tracking-widest hover:bg-modern-primary/90 disabled:opacity-50 transition-all flex items-center gap-2"
                                >
                                  {isLinkingKey ? "..." : "Conectar"}
                                </button>
                              </div>
                              {keyError && <p className="text-[10px] font-bold text-rose-500 uppercase tracking-tighter">{keyError}</p>}
                            </div>
                          )}
                        </div>
                      </>
                    )}
                  </div>
                )}
              </div>

              <div className="p-8 bg-slate-50 border-t border-modern-border">
                <button 
                  onClick={() => {
                    localStorage.setItem('crm_webhook_url', webhookUrl);
                    localStorage.setItem('crm_sheet_sync_url', sheetSyncUrl);
                    setShowSettings(false);
                  }}
                  className="w-full bg-modern-text text-white py-4 font-bold text-sm uppercase tracking-widest hover:bg-black transition-all flex items-center justify-center gap-2"
                >
                  <CheckCircle2 size={18} /> Pronto
                </button>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Add Sale Modal */}
      <AnimatePresence>
        {showAddSaleModal && (
          <>
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowAddSaleModal(false)}
              className="fixed inset-0 z-[60] bg-modern-text/40 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-md bg-white shadow-2xl z-[70] p-8 rounded-none border border-modern-border"
            >
              <div className="flex items-center justify-between mb-8">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-emerald-100 flex items-center justify-center text-emerald-600">
                    <DollarSign size={20} />
                  </div>
                  <div>
                    <h3 className="text-sm font-extrabold text-modern-text uppercase tracking-widest">
                      {editingSaleId ? "Editar Venda" : "Registrar Venda"}
                    </h3>
                    <p className="text-[10px] font-bold text-modern-secondary uppercase tracking-wider">{selectedClient?.nome}</p>
                  </div>
                </div>
                <button onClick={() => setShowAddSaleModal(false)} className="text-modern-secondary hover:text-modern-text">
                  <X size={20} />
                </button>
              </div>

              <div className="space-y-6">
                <div className="space-y-2">
                  <label className="text-[10px] font-bold uppercase tracking-wider text-modern-secondary">Produto Vendido</label>
                  <select 
                    value={saleForm.productIndex}
                    onChange={(e) => setSaleForm({ ...saleForm, productIndex: parseInt(e.target.value) })}
                    className="w-full px-4 py-3 bg-slate-50 border border-modern-border rounded-none text-sm font-medium focus:outline-none focus:ring-2 focus:ring-modern-primary/20 transition-all"
                  >
                    {MANUAL_PRODUCTS.map((p: any, i) => (
                      <option key={i} value={i}>{p.name} ({p.fixedCommission !== undefined ? `R$ ${p.fixedCommission.toFixed(2)}` : `${(p.commissionRate || 0) * 100}%`})</option>
                    ))}
                  </select>
                </div>

                <div className="space-y-2">
                  <label className="text-[10px] font-bold uppercase tracking-wider text-modern-secondary">Valor da Venda (R$)</label>
                  <input 
                    type="text" 
                    value={saleForm.value}
                    onChange={(e) => setSaleForm({ ...saleForm, value: e.target.value })}
                    placeholder="Ex: 97,00"
                    className="w-full px-4 py-3 bg-slate-50 border border-modern-border rounded-none text-sm font-medium focus:outline-none focus:ring-2 focus:ring-modern-primary/20 transition-all"
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <label className="text-[10px] font-bold uppercase tracking-wider text-modern-secondary">Data da Venda</label>
                    <input 
                      type="date" 
                      value={saleForm.date}
                      onChange={(e) => setSaleForm({ ...saleForm, date: e.target.value })}
                      className="w-full px-4 py-3 bg-slate-50 border border-modern-border rounded-none text-sm font-medium focus:outline-none focus:ring-2 focus:ring-modern-primary/20 transition-all"
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-[10px] font-bold uppercase tracking-wider text-modern-secondary">Horário</label>
                    <input 
                      type="time" 
                      value={saleForm.time}
                      onChange={(e) => setSaleForm({ ...saleForm, time: e.target.value })}
                      className="w-full px-4 py-3 bg-slate-50 border border-modern-border rounded-none text-sm font-medium focus:outline-none focus:ring-2 focus:ring-modern-primary/20 transition-all"
                    />
                  </div>
                </div>

                <div className="pt-4">
                  <div className="bg-emerald-50 p-4 border border-emerald-100 mb-6">
                    <div className="flex justify-between items-center">
                      <p className="text-[10px] font-bold text-emerald-700 uppercase tracking-wider">Sua Comissão Estimada:</p>
                      <p className="text-lg font-extrabold text-emerald-600">
                        {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(
                          (() => {
                            const p = MANUAL_PRODUCTS[saleForm.productIndex] as any;
                            if (p.fixedCommission !== undefined) return p.fixedCommission;
                            return (parseFloat(saleForm.value.replace(',', '.')) || 0) * (p.commissionRate || 0);
                          })()
                        )}
                      </p>
                    </div>
                  </div>

                    <button 
                      onClick={handleAddSale}
                      disabled={!saleForm.value}
                      className="w-full bg-emerald-600 text-white py-4 font-bold text-sm hover:bg-emerald-700 transition-all flex items-center justify-center gap-2 disabled:opacity-50"
                    >
                      <CheckCircle2 size={18} /> {editingSaleId ? "Salvar Alterações" : "Confirmar Venda"}
                    </button>
                </div>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
      {/* WhatsApp Manager Modal */}
      <AnimatePresence>
        {showWhatsappManager && (
          <>
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowWhatsappManager(false)}
              className="fixed inset-0 z-[100] bg-modern-text/60 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-6xl bg-white shadow-2xl z-[101] overflow-hidden flex flex-col h-[700px]"
            >
              <div className="p-8 border-b border-modern-border flex items-center justify-between bg-slate-50">
                <div className="flex items-center gap-4">
                  <div className="w-10 h-10 bg-emerald-600 flex items-center justify-center text-white">
                    <Phone size={20} />
                  </div>
                  <div>
                    <h3 className="text-lg font-black uppercase tracking-tight text-modern-text">Gerenciar WhatsApps</h3>
                    <p className="text-[10px] font-bold text-modern-secondary uppercase tracking-widest">Configure suas contas de atendimento</p>
                  </div>
                </div>
                <button 
                  onClick={() => {
                    setShowWhatsappManager(false);
                    setWhatsappForm({ name: "", origin: "", color: "#25D366", phoneNumber: "", identifier: "" });
                  }}
                  className="w-10 h-10 flex items-center justify-center rounded-none border border-modern-border bg-white text-modern-secondary hover:text-rose-500 transition-colors"
                >
                  <X size={20} />
                </button>
              </div>

              <div className="flex flex-1 overflow-hidden">
                {/* Left: Form */}
                <div className="w-[380px] p-8 border-r border-modern-border bg-white overflow-y-auto custom-scrollbar">
                  <h4 className="text-[10px] font-black uppercase text-modern-secondary tracking-widest mb-6">
                    {(whatsappForm as any).id ? "Editar Conta" : "Cadastrar Novo"}
                  </h4>
                  <div className="space-y-4">
                    <div>
                      <label className="text-[10px] font-bold uppercase text-modern-secondary mb-1.5 block">Nome do Atendente</label>
                      <input 
                        type="text"
                        placeholder="Ex: Carlos - Suporte"
                        value={whatsappForm.name}
                        onChange={(e) => setWhatsappForm({ ...whatsappForm, name: e.target.value })}
                        className="w-full bg-slate-50 border border-modern-border px-3 py-2.5 text-xs font-bold text-modern-text focus:outline-none"
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="text-[10px] font-bold uppercase text-modern-secondary mb-1.5 block">ID (Número p/ Ícone)</label>
                        <input 
                          type="text"
                          placeholder="Ex: 1"
                          value={whatsappForm.identifier}
                          onChange={(e) => setWhatsappForm({ ...whatsappForm, identifier: e.target.value })}
                          className="w-full bg-slate-50 border border-modern-border px-3 py-2.5 text-xs font-bold text-modern-text focus:outline-none"
                        />
                      </div>
                      <div>
                        <label className="text-[10px] font-bold uppercase text-modern-secondary mb-1.5 block">Cor</label>
                        <input 
                          type="color"
                          value={whatsappForm.color}
                          onChange={(e) => setWhatsappForm({ ...whatsappForm, color: e.target.value })}
                          className="w-full h-[38px] cursor-pointer bg-white border border-modern-border p-1"
                        />
                      </div>
                    </div>
                    <div>
                      <label className="text-[10px] font-bold uppercase text-modern-secondary mb-1.5 block">Origem / Canal</label>
                      <input 
                        type="text"
                        placeholder="Ex: Instagram, FB Ads"
                        value={whatsappForm.origin}
                        onChange={(e) => setWhatsappForm({ ...whatsappForm, origin: e.target.value })}
                        className="w-full bg-slate-50 border border-modern-border px-3 py-2.5 text-xs font-bold text-modern-text focus:outline-none"
                      />
                    </div>
                    <div>
                      <label className="text-[10px] font-bold uppercase text-modern-secondary mb-1.5 block">Telefone (Opcional)</label>
                      <input 
                        type="text"
                        placeholder="Ex: 5511..."
                        value={whatsappForm.phoneNumber}
                        onChange={(e) => setWhatsappForm({ ...whatsappForm, phoneNumber: e.target.value })}
                        className="w-full bg-slate-50 border border-modern-border px-3 py-2.5 text-xs font-bold text-modern-text focus:outline-none"
                      />
                    </div>
                    <div className="flex flex-col gap-2 pt-2">
                      <button 
                        onClick={saveWhatsappAccount}
                        disabled={isSavingWhatsapp}
                        className="w-full bg-emerald-600 text-white py-3 font-black text-xs uppercase tracking-widest hover:bg-emerald-700 transition-all shadow-md shadow-emerald-500/20 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                      >
                        {isSavingWhatsapp ? (
                          <>
                            <div className="w-4 h-4 border-2 border-white/30 border-t-white animate-spin" />
                            Salvando...
                          </>
                        ) : (whatsappForm as any).id ? "Atualizar Conta" : "Salvar Conta"}
                      </button>
                      {(whatsappForm as any).id && (
                        <button 
                          onClick={() => setWhatsappForm({ name: "", origin: "", color: "#25D366", phoneNumber: "", identifier: "" })}
                          className="w-full bg-slate-100 text-modern-secondary py-3 font-black text-xs uppercase tracking-widest hover:bg-slate-200 transition-all"
                        >
                          Cancelar Edição
                        </button>
                      )}
                    </div>
                  </div>
                </div>

                {/* Right: List */}
                <div className="flex-1 p-8 bg-slate-100/50 overflow-y-auto custom-scrollbar">
                  <h4 className="text-[10px] font-black uppercase text-modern-secondary tracking-widest mb-6">Contas Ativas ({whatsappAccounts.length})</h4>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pb-4">
                    {whatsappAccounts.map(acc => (
                      <div key={acc.id} className="bg-white border border-modern-border p-5 shadow-sm group hover:border-emerald-500/50 transition-all flex flex-col min-h-[140px]">
                        <div className="flex items-start justify-between">
                          <div className="flex items-center gap-4 min-w-0 flex-1">
                            <div 
                              className="w-10 h-10 flex items-center justify-center text-white shrink-0 shadow-sm"
                              style={{ backgroundColor: acc.color }}
                            >
                              <span className="text-[11px] font-black">{acc.identifier}</span>
                            </div>
                            <div className="min-w-0 flex-1 pr-2">
                              <p className="text-sm font-black uppercase text-modern-text whitespace-normal break-words leading-tight mb-1">{acc.name}</p>
                              <p className="text-[9px] font-bold text-modern-secondary uppercase tracking-wider">{acc.origin || 'Sem origem'}</p>
                            </div>
                          </div>
                          <div className="flex items-center gap-1 shrink-0 opacity-0 group-hover:opacity-100 transition-all ml-2">
                            <button 
                              onClick={() => setWhatsappForm(acc as any)}
                              className="w-9 h-9 flex items-center justify-center text-modern-secondary hover:text-emerald-600 bg-slate-50 hover:bg-emerald-50 border border-modern-border transition-all"
                              title="Editar"
                            >
                              <Edit size={16} />
                            </button>
                            <button 
                              onClick={() => deleteWhatsappAccount(acc.id)}
                              className="w-9 h-9 flex items-center justify-center text-modern-secondary hover:text-rose-500 bg-slate-50 hover:bg-rose-50 border border-modern-border transition-all"
                              title="Excluir"
                            >
                              <Trash2 size={16} />
                            </button>
                          </div>
                        </div>
                        {acc.phoneNumber && (
                          <div className="mt-3 pt-3 border-t border-slate-100">
                            <p className="text-[10px] font-bold text-modern-secondary flex items-center gap-2">
                               <Phone size={12} className="text-emerald-500" /> {acc.phoneNumber}
                            </p>
                          </div>
                        )}
                      </div>
                    ))}
                    {whatsappAccounts.length === 0 && (
                      <div className="col-span-full text-center py-20 opacity-40">
                        <Phone size={48} className="mx-auto mb-4 text-modern-secondary" />
                        <p className="text-xs font-bold uppercase tracking-widest text-modern-secondary italic">Nenhuma conta cadastrada</p>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}
