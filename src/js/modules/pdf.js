export const AppPDF = {
  generateReceipt: async function (tool, userName) {
    if (!window.jspdf) {
      window.App.UI.showToast('Motor PDF...', 'info');
      try {
        await window.Utils.loadScript(
          'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js'
        );
      } catch {
        return window.App.UI.showToast('Erro de rede.', 'error');
      }
    }
    if (!window.jspdf || !window.jspdf.jsPDF) {
      return;
    }
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF();
    const d = new Date();
    const rId =
      d.getFullYear().toString() +
      (d.getMonth() + 1).toString().padStart(2, '0') +
      d.getDate().toString().padStart(2, '0') +
      '-' +
      Math.floor(Math.random() * 10000)
        .toString()
        .padStart(4, '0');
    const dF = `${d.toLocaleDateString('pt-BR')} às ${d.toLocaleTimeString('pt-BR')}`;
    const uObj = window.App.Data.collaborators.find((u) => u.name === userName) || {};

    doc.setFillColor(30, 58, 138);
    doc.rect(0, 0, 210, 35, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(24);
    doc.text('FERRAMENTAS', 20, 20);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.text('SISTEMA DE GESTÃO DE FERRAMENTAS', 20, 27);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(12);
    doc.text('TERMO DE RESPONSABILIDADE', 190, 20, { align: 'right' });
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(220, 220, 220);
    doc.text(`Protocolo: ${rId}`, 190, 27, { align: 'right' });

    doc.setTextColor(40, 40, 40);
    doc.setFontSize(10);
    doc.setFont('helvetica', 'normal');
    doc.text(
      doc.splitTextToSize(
        'Pelo presente termo, o colaborador abaixo qualificado declara ter recebido a ferramenta descrita neste documento, assumindo total responsabilidade por sua guarda, conservação e correto uso, de acordo com as normas da empresa.\n\nO colaborador compromete-se a devolvê-la nas mesmas condições em que foi retirada ou a ressarcir a empresa em caso de perda, roubo, extravio ou danos decorrentes de mau uso, negligência ou imperícia.',
        170
      ),
      20,
      50
    );

    let sY = 85;
    doc.setFillColor(255, 255, 255);
    doc.setDrawColor(180, 180, 180);
    doc.setLineWidth(0.4);
    doc.roundedRect(20, sY, 170, 35, 3, 3, 'FD');
    doc.setDrawColor(220, 220, 220);
    doc.line(20, sY + 11, 190, sY + 11);
    doc.setTextColor(30, 58, 138);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.text('DADOS DO PATRIMÔNIO', 25, sY + 7);
    doc.setTextColor(0, 0, 0);
    doc.setFontSize(9);
    doc.setFont('helvetica', 'bold');
    doc.text('Código/Patrimônio: ', 25, sY + 18);
    doc.setFont('helvetica', 'normal');
    doc.text(tool.code, 65, sY + 18);
    doc.setFont('helvetica', 'bold');
    doc.text('Descrição: ', 25, sY + 25);
    doc.setFont('helvetica', 'normal');
    doc.text(tool.name, 65, sY + 25);
    doc.setFont('helvetica', 'bold');
    doc.text('Categoria: ', 25, sY + 32);
    doc.setFont('helvetica', 'normal');
    doc.text(tool.category, 65, sY + 32);

    sY += 45;
    doc.setFillColor(255, 255, 255);
    doc.setDrawColor(180, 180, 180);
    doc.setLineWidth(0.4);
    doc.roundedRect(20, sY, 170, 35, 3, 3, 'FD');
    doc.setDrawColor(220, 220, 220);
    doc.line(20, sY + 11, 190, sY + 11);
    doc.setTextColor(30, 58, 138);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.text('DADOS DO COLABORADOR E RETIRADA', 25, sY + 7);
    doc.setTextColor(0, 0, 0);
    doc.setFontSize(9);
    doc.setFont('helvetica', 'bold');
    doc.text('Nome: ', 25, sY + 18);
    doc.setFont('helvetica', 'normal');
    doc.text(userName, 65, sY + 18);
    doc.setFont('helvetica', 'bold');
    doc.text('Ponto/Crachá: ', 25, sY + 25);
    doc.setFont('helvetica', 'normal');
    doc.text(uObj.badge || 'Não registrado', 65, sY + 25);
    doc.setFont('helvetica', 'bold');
    doc.text('Função/Depto: ', 115, sY + 25);
    doc.setFont('helvetica', 'normal');
    doc.text(uObj.role || uObj.department || 'Não registrada', 140, sY + 25);
    doc.setFont('helvetica', 'bold');
    doc.text('Data: ', 25, sY + 32);
    doc.setFont('helvetica', 'normal');
    doc.text(dF, 65, sY + 32);

    sY += 50;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.text('DECLARAÇÃO DE CONFORMIDADE', 20, sY);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.text(
      'Declaro ter conferido e recebido o material acima descrito em perfeitas condições de uso.',
      20,
      sY + 6
    );

    sY += 30;
    doc.setDrawColor(100, 100, 100);
    doc.setLineWidth(0.3);
    doc.line(30, sY, 95, sY);
    doc.line(115, sY, 180, sY);
    doc.setTextColor(0, 0, 0);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.text(userName, 62.5, sY + 5, { align: 'center' });
    doc.text('Administração', 147.5, sY + 5, { align: 'center' });
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.text('Assinatura do Colaborador', 62.5, sY + 9, {
      align: 'center'
    });
    doc.text('Assinatura do Emissor', 147.5, sY + 9, { align: 'center' });
    doc.save(`Termo_${tool.code}_${userName.replace(/\s+/g, '_')}.pdf`);
  }
};
