import globalSetup from './support/global-setup.mjs';
import { deleteCollaborators, readCollaborators } from './support/admin-db.mjs';
import { expect, expectActiveTab, loginAs, openTab, test } from './support/fixtures.js';
import { E2E_COLLABORATORS, E2E_EXPECTED_COUNTS, E2E_USERS } from './support/seed-data.mjs';

// Addendum 1-F3.1: escrita REAL no Firebase Emulator (nunca em produção: as fixtures recusam
// qualquer outro host) pelo fluxo real da aplicação. Nada de espião no lugar de saveCollaborator.
// A persistência é conferida direto no Firestore do emulator (support/admin-db.mjs).
// Roda por último (projeto "destructive-collaborators", depois de "destructive-tools") porque cria e
// altera documentos semeados; o emulator é re-semeado ao final.
test.describe.configure({ mode: 'serial' });

const SEEDED = Object.keys(E2E_COLLABORATORS);
const created = [];

// O seed faz upsert e não apaga documentos extras: o que o spec criar é removido aqui.
test.afterAll(async () => {
  await deleteCollaborators(created);
  await globalSetup();
});

const countText = (page) => page.locator('#collab-result-count');
const row = (page, name) => page.locator('#collab-list [data-collab-row]', { hasText: name });

async function openCollaborators(page, user = E2E_USERS.admin) {
  await loginAs(page, user);
  await openTab(page, 'collaborators');
  await expectActiveTab(page, 'collaborators');
  await expect(page.locator('#collab-list')).toContainText('Colaborador Alfa');
}

async function openForm(page) {
  await page.locator('#btn-collaborators-new').click();
  await expect(page.locator('#crud-collab-modal')).toBeVisible();
}

async function fillForm(page, { badge, name, role = '', phone = '' }) {
  await page.locator('#crud-collab-badge').fill(badge);
  await page.locator('#crud-collab-name').fill(name);
  await page.locator('#crud-collab-role').fill(role);
  await page.locator('#crud-collab-phone').fill(phone);
}

// Registra os ids criados durante o teste, para a limpeza do afterAll.
async function trackCreated(before, after) {
  const known = new Set([...SEEDED, ...before.map((c) => c.firebaseId)]);

  after.forEach((c) => {
    if (!known.has(c.firebaseId) && !created.includes(c.firebaseId)) {
      created.push(c.firebaseId);
    }
  });
}

test('criação: o fluxo real grava exatamente um colaborador no emulator e a lista reflete', async ({
  page,
}) => {
  const NEW = {
    badge: 'E2E-ADD-101',
    name: 'Addendum Criacao',
    role: 'Teste Addendum',
    phone: '11988887777',
  };

  await openCollaborators(page);
  await expect(countText(page)).toHaveText('Mostrando 5 de 5 colaboradores');

  const before = await readCollaborators();

  expect(before).toHaveLength(E2E_EXPECTED_COUNTS.collaborators);

  await openForm(page);
  await fillForm(page, NEW);
  await page.locator('#btn-save-collab').click();

  // Fluxo real concluído: toast de sucesso e o formulário fecha sozinho.
  await expect(
    page.locator('.toast-item').filter({ hasText: 'Salvo com sucesso.' }).first()
  ).toBeVisible();
  await expect(page.locator('#crud-collab-modal')).toBeHidden();

  // UI: o novo colaborador entra na lista, no seu próprio grupo de cargo, já como Ativo.
  await expect(countText(page)).toHaveText('Mostrando 6 de 6 colaboradores');
  await expect(row(page, NEW.name)).toContainText(NEW.badge);
  await expect(row(page, NEW.name)).toContainText('Ativo');
  await expect(row(page, NEW.name)).toContainText(NEW.phone);
  await expect(page.locator('.collab-group__name')).toContainText([NEW.role]);

  // Persistência: exatamente UMA criação, com os campos do contrato de antes.
  const after = await readCollaborators();

  await trackCreated(before, after);

  const matches = after.filter((c) => c.badge === NEW.badge);

  expect(matches, 'exatamente um documento criado').toHaveLength(1);
  expect(after).toHaveLength(before.length + 1);
  expect(matches[0]).toMatchObject({
    badge: NEW.badge,
    name: NEW.name,
    role: NEW.role,
    phone: NEW.phone,
    status: 'active',
    imageUrl: null,
  });
});

test('envio duplo: o segundo clique real é barrado pela guarda isBusy e não cria duplicata', async ({
  page,
}) => {
  const NEW = { badge: 'E2E-ADD-102', name: 'Addendum Envio Duplo', role: 'Teste Addendum' };

  await openCollaborators(page);

  const before = await readCollaborators();

  await openForm(page);
  await fillForm(page, NEW);

  // Dois cliques REAIS no botão de produção, no mesmo passo síncrono. Nada é substituído: só
  // observamos os cliques entregues e as transições de aria-busy do próprio botão.
  const attempt = await page.evaluate(() => {
    const button = document.getElementById('btn-save-collab');

    window.__busyStates = [];
    window.__clicks = 0;

    button.addEventListener('click', () => {
      window.__clicks += 1;
    });
    new MutationObserver(() => {
      window.__busyStates.push(button.getAttribute('aria-busy'));
    }).observe(button, { attributes: true, attributeFilter: ['aria-busy'] });

    button.click();

    // Estado logo depois do 1º clique, enquanto o 2º ainda nem foi disparado.
    const busyBetweenClicks = button.getAttribute('aria-busy');

    button.click();

    return { busyBetweenClicks, clicks: window.__clicks };
  });

  expect(attempt.clicks, 'os dois cliques foram entregues ao botão real').toBe(2);
  expect(attempt.busyBetweenClicks, 'o botão já estava ocupado no 2º clique').toBe('true');

  await expect(
    page.locator('.toast-item').filter({ hasText: 'Salvo com sucesso.' }).first()
  ).toBeVisible();
  await expect(page.locator('#crud-collab-modal')).toBeHidden();

  // A UI volta ao estado correto: o botão deixa de estar ocupado.
  const final = await page.evaluate(() => ({
    busyStates: window.__busyStates,
    busyNow: document.getElementById('btn-save-collab').getAttribute('aria-busy'),
  }));

  // Ocupado enquanto grava e liberado ao final: as duas transições do botão real, nesta ordem.
  expect(final.busyStates, 'ocupado durante a gravação e liberado ao final').toEqual(['true', null]);
  expect(final.busyNow).toBeNull();

  // Uma única gravação efetiva, apesar das duas tentativas.
  const after = await readCollaborators();

  await trackCreated(before, after);

  expect(after.filter((c) => c.badge === NEW.badge), 'sem duplicata').toHaveLength(1);
  expect(after.filter((c) => c.name === NEW.name)).toHaveLength(1);
  expect(after).toHaveLength(before.length + 1);
  await expect(countText(page)).toHaveText(`Mostrando ${before.length + 1} de ${before.length + 1} colaboradores`);
});

test('edição: o fluxo real atualiza o documento existente, sem criar outro', async ({ page }) => {
  const TARGET = 'Colaborador Delta';
  const NEW_ROLE = 'Coordenacao Addendum';

  await openCollaborators(page);

  const before = await readCollaborators();
  const original = before.find((c) => c.name === TARGET);

  expect(original, 'colaborador do seed presente').toBeTruthy();
  expect(original.role).toBe('Supervisor');

  await row(page, TARGET)
    .getByRole('button', { name: `Mais ações de ${TARGET}` })
    .click();
  await page.getByRole('menuitem', { name: 'Editar' }).click();
  await expect(page.locator('#crud-collab-modal')).toBeVisible();
  await expect(page.locator('#crud-collab-badge')).toHaveValue(original.badge);

  // Campo seguro: o cargo só organiza a lista. O crachá NÃO é tocado.
  await page.locator('#crud-collab-role').fill(NEW_ROLE);
  await page.locator('#btn-save-collab').click();

  await expect(
    page.locator('.toast-item').filter({ hasText: 'Salvo com sucesso.' }).first()
  ).toBeVisible();
  await expect(page.locator('#crud-collab-modal')).toBeHidden();

  // UI: a pessoa migra para o grupo novo, sem duplicar a linha.
  await expect(page.locator('.collab-group__name')).toContainText([NEW_ROLE]);
  await expect(row(page, TARGET)).toHaveCount(1);
  await expect(page.locator('.collab-group__name')).not.toContainText(['Supervisor']);

  // Persistência: mesmo documento, cargo novo, crachá e identidade intactos.
  const after = await readCollaborators();

  await trackCreated(before, after);

  expect(after, 'nenhum documento criado na edição').toHaveLength(before.length);

  const updated = after.find((c) => c.firebaseId === original.firebaseId);

  expect(updated).toMatchObject({
    badge: original.badge,
    name: original.name,
    role: NEW_ROLE,
    status: original.status,
  });
  expect(after.filter((c) => c.name === TARGET)).toHaveLength(1);
});

test('erros reais do formulário: mensagem no campo, botão liberado e nova tentativa funciona', async ({
  page,
}) => {
  await openCollaborators(page);

  const before = await readCollaborators();

  await openForm(page);

  // (A) Obrigatórios: erro ligado ao campo, sem gravar nada. O botão NUNCA chega a ficar ocupado.
  await page.locator('#btn-save-collab').click();
  await expect(page.locator('#crud-collab-badge-error')).toHaveText('Informe o crachá / ponto.');
  await expect(page.locator('#crud-collab-name-error')).toHaveText('Informe o nome.');
  await expect(page.locator('#crud-collab-badge')).toHaveAttribute('aria-invalid', 'true');
  await expect(page.locator('#crud-collab-badge')).toBeFocused();
  await expect(page.locator('#btn-save-collab')).not.toHaveAttribute('aria-busy', 'true');
  await expect(page.locator('#crud-collab-modal')).toBeVisible();

  // (B) Crachá duplicado: mesma regra de unicidade de antes, também sem gravar.
  await fillForm(page, { badge: E2E_COLLABORATORS['c-e2e-1'].badge, name: 'Addendum Duplicado' });
  await page.locator('#btn-save-collab').click();
  await expect(page.locator('#crud-collab-badge-error')).toHaveText(
    'Este crachá / ponto já está cadastrado.'
  );
  await expect(page.locator('#btn-save-collab')).not.toHaveAttribute('aria-busy', 'true');

  // (C) Nova tentativa com dado válido: o erro some e a gravação real acontece.
  const RETRY = { badge: 'E2E-ADD-103', name: 'Addendum Retentativa', role: 'Teste Addendum' };

  await fillForm(page, RETRY);
  await page.locator('#btn-save-collab').click();
  await expect(
    page.locator('.toast-item').filter({ hasText: 'Salvo com sucesso.' }).first()
  ).toBeVisible();
  await expect(page.locator('#crud-collab-modal')).toBeHidden();

  const after = await readCollaborators();

  await trackCreated(before, after);

  expect(after.filter((c) => c.badge === RETRY.badge)).toHaveLength(1);
  expect(after, 'só a tentativa válida gravou').toHaveLength(before.length + 1);
});

test('falha real durante o salvamento: o botão é liberado e a nova tentativa grava', async ({
  page,
  guard,
}) => {
  // Falha determinística e LOCAL dentro do try de saveCollaborator: a imagem anexada não decodifica,
  // então compressImageToBase64 rejeita ANTES de qualquer escrita no Firestore (nenhuma escrita fica
  // pendente para ser reenviada depois). Exercita o catch (toast) e o finally (setBusy liberado).
  guard.allow(/Erro ao salvar/, 'falha de salvamento provocada de propósito neste teste');
  guard.allow(/ERRO\] Erro ao salvar/, 'console.error do Logger na mesma falha provocada');

  await openCollaborators(page);

  const before = await readCollaborators();

  await openForm(page);
  await fillForm(page, { badge: 'E2E-ADD-104', name: 'Addendum Falha', role: 'Teste Addendum' });
  await page.locator('#crud-collab-image').setInputFiles({
    name: 'quebrada.png',
    mimeType: 'image/png',
    buffer: Buffer.from('isto nao e uma imagem valida'),
  });

  await page.locator('#btn-save-collab').click();

  // O erro é comunicado e o formulário continua aberto para correção.
  await expect(
    page.locator('.toast-item').filter({ hasText: 'Erro ao salvar.' }).first()
  ).toBeVisible();
  await expect(page.locator('#crud-collab-modal')).toBeVisible();
  await expect(page.locator('#btn-save-collab')).not.toHaveAttribute('aria-busy', 'true');

  // Nada foi gravado.
  expect(await readCollaborators()).toHaveLength(before.length);

  // Nova tentativa, agora sem a imagem quebrada: grava normalmente.
  const RETRY = { badge: 'E2E-ADD-105', name: 'Addendum Pos Falha', role: 'Teste Addendum' };

  await page.evaluate(() => {
    document.getElementById('crud-collab-image').value = '';
  });
  await fillForm(page, RETRY);
  await page.locator('#btn-save-collab').click();

  await expect(
    page.locator('.toast-item').filter({ hasText: 'Salvo com sucesso.' }).first()
  ).toBeVisible();
  await expect(page.locator('#crud-collab-modal')).toBeHidden();

  const after = await readCollaborators();

  await trackCreated(before, after);

  expect(after.filter((c) => c.badge === RETRY.badge)).toHaveLength(1);
  expect(after).toHaveLength(before.length + 1);
});

test('o perfil restrito continua sem rota e sem dado de colaborador, mesmo após as escritas', async ({
  page,
}) => {
  await loginAs(page, E2E_USERS.restricted, { hash: '#/colaboradores' });

  await expect(page.locator('#topbar-title')).toHaveText('Painel');
  await expect(page.locator('#tab-collaborators')).toBeHidden();
  await expect(page.locator('[data-nav-id="collaborators"]')).toHaveCount(0);

  expect(
    await page.evaluate(() => ({
      collaborators: window.App.Data.collaborators.length,
      listeners: window.App.Data.listeners.length,
      read: window.App.Auth.permissions.canReadCollaborators,
    }))
  ).toEqual({ collaborators: 0, listeners: 1, read: false });

  // Nenhum dos colaboradores criados por este spec vazou para o cliente restrito.
  expect(
    await page.evaluate(() => document.getElementById('main-app').textContent.includes('Addendum'))
  ).toBe(false);
});
