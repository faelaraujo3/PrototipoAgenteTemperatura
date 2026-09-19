# Agente Controlador de Temperatura

Protótipo de um agente inteligente desenvolvido para a disciplina de Inteligência Artificial CSI701

O projeto simula um agente responsável por controlar a temperatura de um ambiente, tomando decisões com base na temperatura atual, na temperatura desejada e nas informações armazenadas em sua memória.

## Sobre o projeto

A proposta é representar o funcionamento de um agente inteligente capaz de:

- verificar a temperatura do ambiente;
- comparar a temperatura atual com a temperatura desejada;
- decidir quando ligar ou desligar o sistema de resfriamento;
- armazenar informações sobre as decisões tomadas;
- utilizar experiências anteriores para fazer novas estimativas;

O projeto é apenas uma simulação, não utilizando sensores ou equipamentos físicos.

## Protótipo

O protótipo da interface foi desenvolvido utilizando o **Figma**, com o objetivo de representar visualmente o funcionamento do agente durante a simulação.

A interface apresenta informações como:

- temperatura atual;
- temperatura desejada;
- estado do sistema;
- tempo de espera;
- última decisão tomada;
- histórico de decisões;
- memória do agente;
- velocidades médias de aquecimento e resfriamento;
- gráfico da temperatura.

Também é possível controlar a simulação através de ações como iniciar, pausar, avançar e reiniciar.

## Funcionamento

O agente segue, de forma geral, o seguinte ciclo:

```text
Verificar
   ↓
Ler a temperatura
   ↓
Consultar a memória
   ↓
Tomar uma decisão
   ↓
Executar a ação
   ↓
Registrar o resultado
   ↓
Aprender com a situação
   ↓
Esperar
   ↓
Verificar novamente
