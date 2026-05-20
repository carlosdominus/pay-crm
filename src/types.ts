export interface Lead {
  id: string;
  nome: string;
  telefone: string;
  email: string;
  produto: string;
  valor: string;
  status: string;
  codPay: string;
  data: string;
  hora: string;
  timestamp: number;
  numericValue: number;
  paymentMethod?: string;
  rowNumber?: number;
  checkoutUrl?: string; // Column V
  // UTM Fields
  src?: string;
  sck?: string;
  utm_source?: string;
  utm_medium?: string;
  utm_campaign?: string;
  utm_content?: string;
  utm_term?: string;
  ttcid?: string;
  adId?: string;
  tags?: string;
}

export interface WhatsAppAccount {
  id: string;
  name: string;
  origin: string;
  color: string;
  phoneNumber: string;
  identifier: string; // The "numero de identificação ID" requested
}

export interface ManualSale {
  id: string;
  clientKey: string;
  productName: string;
  value: number;
  commission: number;
  date: string;
  timestamp: number;
}

export interface WorkspaceInvite {
  id: string;
  ownerEmail: string;
  ownerUid: string;
  inviteeEmail: string;
  status: 'pending' | 'accepted';
  createdAt: string;
}

export interface WorkspaceKey {
  key: string;
  ownerUid: string;
  ownerEmail: string;
  ownerDomain?: string;
  domainAccessEnabled?: boolean;
  createdAt: string;
}

export type ClientTag = 'pendente' | 'vendido' | 'lixo' | 'contato_sucesso' | 'contato_falha' | 'reloginho';

export interface InteractionLog {
  id: string;
  clientKey: string;
  type: 'tag_change' | 'payment_status_change' | 'manual_sale' | 'tracking_code';
  content: string;
  timestamp: string;
}

export interface Client {
  email: string;
  nome: string;
  telefone: string;
  key: string;
  leads: Lead[];
  totalSpent: number;
  lastPurchaseDate: string;
  lastPurchaseTimestamp: number;
  status: string; // Overall status (e.g., most recent)
  tag?: ClientTag | null;
  tagUpdatedAt?: string;
  paymentStatus?: 'link_enviado' | 'pix_enviado' | 'boleto_enviado' | null;
  paymentStatusUpdatedAt?: string;
  potsCount?: number; // 1, 3, or 6
  manualSales?: ManualSale[];
  trackingCode?: string;
  assignedWhatsappId?: string;
}

export const FUNNEL_STEPS = [
  "Novos Leads",
  "Protocolo Força Natural",
  "Diagnóstico Personalizado",
  "Bônus Especial",
  "Tônico do Cavalo"
];

export const STATUS_THEMES: Record<string, { bg: string; text: string }> = {
  "Aprovado": { bg: "bg-[#00BC7D]", text: "text-white" },
  "Pendente": { bg: "bg-[#FE9900]", text: "text-white" },
  "Cancelado": { bg: "bg-[#EC1A40]", text: "text-white" },
  "Recusado": { bg: "bg-[#EC1A40]", text: "text-white" },
  "Reembolsado": { bg: "bg-blue-500", text: "text-white" },
  "Carrinho Abandonado": { bg: "bg-[#8FA1B9]", text: "text-white" },
  "Expirado": { bg: "bg-[#F44900]", text: "text-white" },
  "Lixo": { bg: "bg-rose-100", text: "text-rose-600" },
};
