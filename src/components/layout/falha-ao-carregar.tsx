import React from "react";

interface Props {
  children: React.ReactNode;
}

interface Estado {
  falhou: boolean;
}

/**
 * Cerca as telas carregadas sob demanda. Se o download de uma delas falhar
 * (rede instável, ou um deploy novo enquanto a aba estava aberta e o arquivo
 * antigo não existe mais), mostra um aviso com a opção de recarregar, em vez
 * de deixar a página em branco.
 */
export class FalhaAoCarregar extends React.Component<Props, Estado> {
  state: Estado = { falhou: false };

  static getDerivedStateFromError(): Estado {
    return { falhou: true };
  }

  componentDidCatch(erro: unknown) {
    console.warn("Falha ao carregar a tela:", erro);
  }

  render() {
    if (!this.state.falhou) return this.props.children;
    return (
      <div className="container mx-auto max-w-md px-4 py-16 text-center" role="alert">
        <h1 className="text-xl font-bold text-white mb-2">Não foi possível carregar esta tela</h1>
        <p className="text-sm text-zinc-400 mb-6">
          Verifique a conexão com a internet e recarregue a página.
        </p>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-500"
        >
          Recarregar
        </button>
      </div>
    );
  }
}
