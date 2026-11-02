import React, { useState, useEffect, useCallback } from "react";
import { createClient } from "@supabase/supabase-js";
import { UserPlus, Trash2, Loader2 } from "lucide-react";

// Usuários "atendente": só enxergam Pedidos, Balcão, Cardápio e Contatos.
// Só o administrador chega aqui (aba Configurações).
export default function UsuariosPainel({ supabase, C, Card, FieldLabel, inputStyle, btnPrimary, iconBtnStyle, showToast }) {
  const [lista, setLista] = useState([]);
  const [carregando, setCarregando] = useState(false);
  const [erroLista, setErroLista] = useState("");
  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");
  const [criando, setCriando] = useState(false);
  const [aviso, setAviso] = useState("");

  const carregar = useCallback(async () => {
    setCarregando(true);
    const { data, error } = await supabase.rpc("listar_atendentes");
    setCarregando(false);
    if (error) {
      console.error(error);
      setErroLista("Não foi possível carregar os usuários. Confira se o arquivo supabase/migracao-funcionario.sql foi rodado no Supabase.");
      return;
    }
    setErroLista("");
    setLista(data || []);
  }, [supabase]);

  useEffect(() => { carregar(); }, [carregar]);

  const criar = async () => {
    const em = email.trim().toLowerCase();
    if (!/^\S+@\S+\.\S+$/.test(em)) { setAviso("Informe um e-mail válido."); return; }
    if (senha && senha.length < 6) { setAviso("A senha precisa ter pelo menos 6 caracteres."); return; }
    setCriando(true);
    setAviso("");

    // 1) cria o login (cliente separado, para não derrubar a sua sessão de administrador)
    let erroCadastro = "";
    if (senha) {
      const url = supabase.supabaseUrl || import.meta.env.VITE_SUPABASE_URL;
      const key = supabase.supabaseKey || import.meta.env.VITE_SUPABASE_ANON_KEY;
      if (!url || !key) {
        erroCadastro = "não consegui acessar a configuração do Supabase";
      } else {
        try {
          const isolado = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
          const { error } = await isolado.auth.signUp({ email: em, password: senha });
          if (error && !/already|registered|exists/i.test(error.message || "")) erroCadastro = error.message || "erro ao criar o login";
        } catch (e) {
          erroCadastro = (e && e.message) || "erro ao criar o login";
        }
      }
    }

    // 2) libera o acesso de atendente (e confirma o e-mail)
    const { error } = await supabase.rpc("registrar_atendente", { p_email: em });
    setCriando(false);
    if (error) {
      console.error(error);
      const msg = error.message || "";
      if (/não encontrado/i.test(msg)) {
        setAviso(
          `O login ainda não existe${erroCadastro ? ` (${erroCadastro})` : ""}. ` +
          "Crie no Supabase em Authentication → Users → Add user (marque Auto Confirm User) e depois toque em Criar usuário de novo, só com o e-mail."
        );
      } else if (/administrador/i.test(msg)) {
        setAviso("Esse e-mail já é de um administrador.");
      } else if (/permiss/i.test(msg)) {
        setAviso("Só o administrador pode criar usuários.");
      } else if (/PGRST202|42883|could not find/i.test(`${error.code} ${msg}`)) {
        setAviso("Falta rodar o arquivo supabase/migracao-funcionario.sql no Supabase.");
      } else {
        setAviso(msg);
      }
      return;
    }
    showToast("Usuário liberado");
    setEmail("");
    setSenha("");
    carregar();
  };

  const remover = async (u) => {
    if (!window.confirm(`Tirar o acesso de ${u.email}? Ele continua existindo no Supabase, mas não vê mais nada no painel.`)) return;
    const { error } = await supabase.rpc("remover_atendente", { p_user_id: u.user_id });
    if (error) {
      console.error(error);
      showToast(`Erro ao remover: ${error.message}`);
      return;
    }
    showToast("Acesso removido");
    carregar();
  };

  return (
    <Card style={{ marginBottom: 16 }}>
      <div style={{ fontSize: 13, fontWeight: 700, color: C.text, marginBottom: 4 }}>Usuários do painel (funcionários)</div>
      <div style={{ fontSize: 12, color: C.textSoft, marginBottom: 12 }}>
        O funcionário entra com e-mail e senha e vê só as abas <b>Pedidos, Balcão, Cardápio e Contatos</b>. Não vê Caixa, Compras, Equipe, Relatórios, Financeiro nem Configurações. Os pedidos que ele lança aparecem para você também.
      </div>

      {erroLista && <div style={{ color: C.red, fontSize: 12.5, marginBottom: 10 }}>{erroLista}</div>}
      {carregando && <div style={{ color: C.textSoft, fontSize: 12.5, marginBottom: 10 }}>Carregando…</div>}
      {!carregando && !erroLista && lista.length === 0 && <div style={{ color: C.textFaint, fontSize: 12.5, marginBottom: 10 }}>Nenhum funcionário cadastrado ainda.</div>}
      {lista.map((u) => (
        <div key={u.user_id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 0", borderBottom: `1px solid ${C.borderSoft}` }}>
          <div style={{ flex: 1, fontSize: 13.5, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}>{u.email}</div>
          <button onClick={() => remover(u)} style={iconBtnStyle} aria-label="Remover acesso"><Trash2 size={16} color={C.red} /></button>
        </div>
      ))}

      <div style={{ marginTop: 14 }}>
        <FieldLabel>Novo funcionário</FieldLabel>
        <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="E-mail do funcionário" type="email" autoComplete="off" style={{ ...inputStyle, marginBottom: 8 }} />
        <input value={senha} onChange={(e) => setSenha(e.target.value)} placeholder="Senha (mínimo 6 caracteres)" type="text" autoComplete="off" style={{ ...inputStyle, marginBottom: 8 }} />
        {aviso && <div style={{ background: C.redSoft, color: C.red, fontSize: 12.5, padding: "9px 12px", borderRadius: 10, marginBottom: 8 }}>{aviso}</div>}
        <button onClick={criar} disabled={criando} style={{ ...btnPrimary, width: "100%", opacity: criando ? 0.7 : 1 }}>
          {criando ? <Loader2 size={16} /> : <UserPlus size={16} />} Criar usuário
        </button>
        <div style={{ fontSize: 11.5, color: C.textFaint, marginTop: 8 }}>
          Se o login já existe no Supabase, deixe a senha em branco e toque em Criar usuário: só o acesso é liberado.
        </div>
      </div>
    </Card>
  );
}
