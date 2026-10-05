import { AcademiaPublica } from "../types/database";

export const ACADEMIA_DEMO_A: AcademiaPublica = {
  id: "de000000-0000-4000-8000-000000000001",
  nome: "Honor Team — Matriz Centro",
  logo_url: null,
  matricula_online_aberta: true,
  modalidades: [
    { id: "de100000-0000-4000-8000-000000000011", nome: "Jiu-Jitsu" },
    { id: "de100000-0000-4000-8000-000000000012", nome: "Muay Thai" },
  ],
  turmas: [
    {
      id: "turma-jj-01",
      nome: "Jiu-Jitsu Adulto — Noite",
      modalidade_id: "de100000-0000-4000-8000-000000000011",
      publico: "adulto",
      horarios: [
        { dia_semana: 1, inicio: "19:00", fim: "20:30" },
        { dia_semana: 3, inicio: "19:00", fim: "20:30" },
        { dia_semana: 5, inicio: "19:00", fim: "20:30" },
      ],
    },
    {
      id: "turma-jj-kids-01",
      nome: "Jiu-Jitsu Kids (6 a 12 anos)",
      modalidade_id: "de100000-0000-4000-8000-000000000011",
      publico: "infantil",
      horarios: [
        { dia_semana: 2, inicio: "17:00", fim: "18:00" },
        { dia_semana: 4, inicio: "17:00", fim: "18:00" },
      ],
    },
    {
      id: "turma-mt-01",
      nome: "Muay Thai Fundamental",
      modalidade_id: "de100000-0000-4000-8000-000000000012",
      publico: "todos",
      horarios: [
        { dia_semana: 2, inicio: "18:30", fim: "19:45" },
        { dia_semana: 4, inicio: "18:30", fim: "19:45" },
      ],
    },
  ],
  planos: [
    {
      id: "plano-mensal",
      nome: "Plano Mensal Livre",
      valor: 169.9,
      periodicidade: "mensal",
    },
    {
      id: "plano-trimestral",
      nome: "Plano Trimestral Fidelidade",
      valor: 149.9,
      periodicidade: "trimestral",
    },
    {
      id: "plano-kids",
      nome: "Plano Kids Especial",
      valor: 130.0,
      periodicidade: "mensal",
    },
  ],
};

export const ACADEMIA_DEMO_B: AcademiaPublica = {
  id: "de000000-0000-4000-8000-000000000002",
  nome: "Honor Team — Filial Zona Sul",
  logo_url: null,
  matricula_online_aberta: false, // Fechada para testes de exibição
  modalidades: [
    { id: "de100000-0000-4000-8000-000000000021", nome: "Jiu-Jitsu" },
  ],
  turmas: [],
  planos: [],
};
