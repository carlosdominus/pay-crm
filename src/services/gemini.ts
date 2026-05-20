import { GoogleGenAI } from "@google/genai";
import { Lead } from "../types";

let genAI: GoogleGenAI | null = null;

function getGenAI() {
  if (!genAI) {
    const meta = import.meta as any;
    const apiKey = meta.env?.VITE_GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error("VITE_GEMINI_API_KEY environment variable is required");
    }
    // @ts-ignore - version compatibility
    genAI = new GoogleGenAI(apiKey);
  }
  return genAI;
}

export async function generatePersonalizedMessage(lead: Lead) {
  const modelName = "gemini-3-flash-preview";
  
  const prompt = `
    Você é um especialista em vendas e customer success do produto "Protocolo Força Natural".
    Sua tarefa é criar uma mensagem personalizada para o WhatsApp para o seguinte cliente:
    
    Nome: ${lead.nome}
    Produto Adquirido: ${lead.produto}
    Valor: ${lead.valor}
    Status da Compra: ${lead.status}
    
    Contexto do Funil:
    1. Protocolo Força Natural (Front-end)
    2. Diagnóstico Personalizado (Upsell 1)
    3. Bônus Especial (Upsell 2)
    4. Tônico do Cavalo (Upsell 3)
    
    Diretrizes da Mensagem:
    - Seja amigável, profissional e persuasivo.
    - Use o nome do cliente.
    - Se o status for "Aprovado", dê as boas-vindas e valide a excelente escolha.
    - Se o status for "Pendente", tente ajudar a concluir o pagamento de forma sutil.
    - Mencione o produto específico que ele comprou.
    - Se ele comprou o "Protocolo Força Natural", mencione que o próximo passo ideal seria o "Diagnóstico Personalizado" se ele quiser acelerar os resultados (mas não force a venda, apenas plante a semente).
    - A mensagem deve ser curta e formatada para WhatsApp (use emojis moderadamente).
    - Responda APENAS com o texto da mensagem.
  `;

  try {
    const ai = getGenAI();
    // @ts-ignore - version compatibility
    const model = ai.getGenerativeModel({ model: modelName });
    const result = await model.generateContent(prompt);
    const response = await result.response;
    return response.text() || "Não foi possível gerar a mensagem.";
  } catch (error) {
    console.error("Erro ao gerar mensagem:", error);
    return "Erro ao conectar com a IA para gerar a mensagem.";
  }
}
