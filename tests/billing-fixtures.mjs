// e-Boekhouden's billing markup for the jsdom tests, as the shell's
// templates render it (app-grid, app-form, app-factuurregel-list and the
// line window app-factuurregel-form). Demo data only.
import { page } from './dom.mjs';

export const SCRIPTS = ['shared.js', 'store.js', 'icons.js', 'dialog.js', 'bridge.js', 'request.js', 'features/invoices.js', 'features/subscriptions.js'];

const identity = '<app-header-identity-b><div class="header-identity"><div class="userInfo"><span class="userName">Demo</span><span class="administratieId">123</span></div></div></app-header-identity-b>';

const checkbox = (id, label, checked = false) => `<div class="form-row"><div class="form-component"><app-form-label><label for="${id}">${label}</label></app-form-label><app-checkbox><div class="form-control form-check"><div class="form-check"><input type="checkbox" id="${id}"${checked ? ' checked' : ''}><span></span></div><label for="${id}"> ${label} </label></div></app-checkbox></div></div>`;
const textRow = (id, label, value = '') => `<div class="form-row"><div class="form-component"><app-form-label><label for="${id}">${label}</label></app-form-label><app-text-input><div class="form-control"><input id="${id}" class="displayValue form-input" value="${value}"></div></app-text-input></div></div>`;
const selectRow = (id, label, options, value) => `<div class="form-row"><div class="form-component"><app-form-label><label for="${id}">${label}</label></app-form-label><app-selectlist><div class="form-control"><select class="form-input fixed" id="${id}" name="${id}">${options.map(([v, l]) => `<option value="${v}"${v === value ? ' selected' : ''}>${l}</option>`).join('')}</select></div></app-selectlist></div></div>`;
// app-autocomplete as its template renders it: with showAdd an app-icon
// "plus" (ng-icon with its svg) right after the input, inside the same div.
export const autocomplete = (id, value = '', { add = false } = {}) => `<app-autocomplete><div class="form-control fixed-width"><div id="${id}-AutocompleteInput"><input autocomplete="off" class="displayValue skipinitfocus form-input show-arrow${add ? ' flat-right show-add' : ''}" id="${id}-AutocompletePickerInput" value="${value}">${add ? '<app-icon name="plus" class="add-button"><ng-icon name="lucidePlus"><svg width="20" height="20" viewBox="0 0 24 24"><path d="M5 12h14"></path><path d="M12 5v14"></path></svg></ng-icon></app-icon>' : ''}</div></div><input type="text" readonly tabindex="-1" class="unfocus"></app-autocomplete>`;
export const autocompleteRow = (id, label, value = '', options = {}) => `<div class="form-row"><div class="form-component"><app-form-label><label for="${id}">${label}</label></app-form-label>${autocomplete(id, value, options)}</div></div>`;

// app-date-picker (mydatepicker) as its template renders it: a day back,
// the input, a day on, and the calendar button with its font icon.
export const datePicker = (id, value = '') => `<app-date-picker><div class="date-picker form-control"><div class="selection-group"><div class="form-inline-group">
  <button type="button" tabindex="-1" class="btn-decrease form-arrow" aria-label="Vorige dag"><app-icon name="chevron-left" size="small"><ng-icon class="small"><svg width="16" height="16"></svg></ng-icon></app-icon></button>
  <input ngtype="text" autocomplete="off" spellcheck="false" autocorrect="off" class="form-input selection skipinitfocus" id="${id}" value="${value}">
  <button type="button" tabindex="-1" class="btn-increase form-arrow" aria-label="Volgende dag"><app-icon name="chevron-right" size="small"><ng-icon class="small"><svg width="16" height="16"></svg></ng-icon></app-icon></button>
  </div><button type="button" tabindex="-1" class="btn-picker" aria-label="Kalender openen"><i class="eb-icon-calendar"></i></button></div></div></app-date-picker>`;
const hidden = (on) => ` custom-hidden="${on ? 'true' : 'false'}"`;
const row = (body, { simple = true, advanced = true } = {}) => `<div class="form-row"${hidden(!advanced && !simple)}><div class="form-component">${body}</div></div>`;
const label = (id, text) => `<app-form-label><label for="${id}" title="">${text}</label></app-form-label>`;
const text = (id, value = '') => `<app-text-input><div class="form-control"><input id="${id}" class="displayValue form-input" value="${value}"></div></app-text-input>`;
const select = (id, options, value) => `<app-selectlist><div class="form-control"><select class="form-input fixed" id="${id}" name="${id}">${options.map(([v, l]) => `<option value="${v}"${v === value ? ' selected' : ''}>${l}</option>`).join('')}</select></div></app-selectlist>`;
const check = (id, text, checked = false, { disabled = false } = {}) => `<app-checkbox><div class="form-control form-check"><div class="form-check"><input type="checkbox" id="${id}"${checked ? ' checked' : ''}${disabled ? ' disabled' : ''}><span></span></div><label for="${id}"> ${text} </label></div></app-checkbox>`;

// ---------------------------------------------------------------------------
// The invoice list
// ---------------------------------------------------------------------------

export function invoiceRow({ date = '28-10-2026', number, relation = 'Demo Klant B.V.', excl = '1.000,00', incl = '1.210,00', due = '12-11-2026', text = '', verwerkt = true, mail = true }) {
  return `<tr>
  <td class="icon-v1 pad"><app-condition-container><div class="grid-multi-check"><input type="checkbox"><span></span></div></app-condition-container></td>
  <td class="icon-v1 pad"><app-grid-delete-column><span title="Verwijderen" class="eb-icon-trash"></span></app-grid-delete-column></td>
  <td class="icon-v1 pad"><app-target-link><a class="eb-icon-edit" title="Wijzigen" href="/facturen/factuur/toevoegen/1"></a></app-target-link></td>
  <td class="fact-icon icon-v1 pad"><app-target-link><a href="/facturen/factuur/0"><span title="Factuur kopiëren" class="eb-icon-docs"></span></a></app-target-link></td>
  <td class="fact-icon icon-v1 pad"><app-target-link><a><span title="Factuur printen" class="eb-icon-print"></span></a></app-target-link></td>
  <td class="fact-icon icon-v1 pad">${mail ? '<a><span title="Factuur e-mailen" class="eb-icon-mail"></span></a>' : ''}</td>
  <td class="dateColumn"> ${date} </td><td> ${number} </td>
  <td><app-grid-inline-menu><a class="label"> ${relation} </a></app-grid-inline-menu></td>
  <td class="numberColumn"> ${excl} </td><td class="numberColumn"> ${incl} </td>
  <td></td><td class="truncate"> ${text} </td><td class="dateColumn"> ${due} </td>
  <td class="fact-icon icon-v1"></td><td class="fact-icon icon-v1"><div class="img-group"></div></td><td></td>
  <td class="fact-icon icon-v1 pad">${verwerkt ? '<span class="eb-icon-inbox" title="Verwerkt op 28-10-2026"></span>' : ''}</td></tr>`;
}

const INVOICE_HEAD = `<tr><th class="no-padding multiselect icon-v1 pad"><div class="grid-multi-check"><input type="checkbox"><span></span></div></th>
  <th class="no-padding"></th><th class="no-padding"></th><th class="no-padding"></th><th class="no-padding"></th><th class="no-padding"></th>
  <th class="header-v1 sortable"><div><div> Datum </div></div></th><th class="header-v1 sortable"><div><div> Nummer </div></div></th>
  <th class="header-v1 sortable"><div><div> Relatie </div></div></th><th class="numberColumn header-v1"><div class="numberCol"><div> Bedrag (excl) </div></div></th>
  <th class="numberColumn header-v1"><div class="numberCol"><div> Bedrag (incl) </div></div></th><th class="header-v1"><div><div> Uw kenmerk </div></div></th>
  <th class="header-v1"><div><div> Factuurtekst </div></div></th><th class="header-v1"><div><div> Uiterste betaaldatum </div></div></th>
  <th class="no-padding"></th><th class="no-padding"></th><th class="no-padding"></th>
  <th class="no-padding fact-icon icon-v1 no-pad header-v1"><div><div title="Factuur verwerkt"><span class="eb-icon-inbox" title="Factuur verwerkt"></span></div></div></th></tr>`;

const BULK = ['Geselecteerde facturen afdrukken', 'Geselecteerde facturen klaarzetten voor incasseren', 'Geselecteerde facturen klaarzetten voor mailen', 'Geselecteerde facturen klaarzetten voor mailen ongedaan maken', 'Geselecteerde facturen verwerken in de boekhouding', 'Geselecteerde regels verwijderen'];

function pagination(count, size = 100, page = 1) {
  if (count < 100) return '<app-pagination></app-pagination>';
  const pages = Math.ceil(count / size);
  const items = Array.from({ length: Math.min(pages, 5) }, (_, i) => `<li${i + 1 === page ? ' class="active"' : ''}> ${i + 1} </li>`).join('');
  return `<app-pagination><div><div class="pagination"><ul><li${page === 1 ? ' class="disabled"' : ''}><i class="eb-icon-left-dir"></i> Vorige </li>${items}<li${page === pages ? ' class="disabled"' : ''}> Volgende <i class="eb-icon-right-dir"></i></li></ul></div>
  <div class="pagesizes"><div class="form-component"><label>Items per pagina:</label><select class="pagesizes-select">${[100, 250, 500, 1000, 2000].map((v) => `<option value="${v}"${v === size ? ' selected' : ''}>${v}</option>`).join('')}</select></div></div></div></app-pagination>`;
}

export function invoiceGrid(rows, { count = rows.length, total = '9.999,99', loading = false } = {}) {
  return `<app-grid><app-grid-header><div class="grid-header"><div><div class="grid-header-title"> Facturen <span> (${count} ${count === 1 ? 'regel' : 'regels'}) </span>${loading ? '<i class="eb-icon-spin6 animate-spin"></i>' : ''}</div></div><div class="grid-header-menu"></div></div></app-grid-header>
  <app-grid-body><div class="grid-container"><table class="grid table-v1"><thead>${INVOICE_HEAD}</thead><tbody>${rows.map(invoiceRow).join('')}</tbody>
  <tfoot><tr>${'<td></td>'.repeat(10)}<td class="numberColumn totalColumn"> ${total} </td>${'<td></td>'.repeat(7)}</tr></tfoot></table></div></app-grid-body>
  <app-grid-footer><div class="grid-footer">${pagination(count)}
  <app-grid-bulk-actions><div class="grid-bulk-actions"><div><div class="grid-bulk-actions-title">Acties</div><ul>${BULK.map((label) => `<app-grid-bulk-action><li><span>${label}</span></li></app-grid-bulk-action>`).join('')}</ul></div></div></app-grid-bulk-actions>
  </div></app-grid-footer></app-grid>`;
}

export function invoiceListHtml(rows, options = {}) {
  const grid = options.noGrid ? '' : invoiceGrid(rows, options);
  const note = options.notification ? `<div class="notifications"><div role="alert" class="notification-bar alert alert-dismissible${options.notification.error ? ' error' : ''}"><div class="notification-container"><div class="notification-message ${options.notification.error ? 'error' : 'success'}"> ${options.notification.message} </div></div></div></div>` : '';
  return `<!doctype html><html><head></head><body>${identity}<app-notification-bar>${note}</app-notification-bar>
  <div id="content"><app-factuur-list>
  <div class="middle-top-container"><app-form><form class="form"><div class="form-header">Facturen zoeken</div><div class="form-body">
    ${textRow('trefwoordRegels', 'Trefwoord factuurregels')}${checkbox('automatischeIncasso', 'Klaar voor automatische incasso')}${checkbox('openstaand', 'Enkel openstaande facturen')}
  </div><div class="form-footer"><div class="form-buttons"><div class="form-submit"><button type="submit" class="button form-submit">Zoeken</button></div></div></div></form></app-form></div>
  <div class="middle-bottom-container"><app-target-link><a class="plain-btn eb-s-icon-right" href="/facturen/factuur/toevoegen/0"><app-icon></app-icon> Toevoegen </a></app-target-link></div>
  <div class="grid-container">${grid}</div>
  </app-factuur-list></div></body></html>`;
}

// ---------------------------------------------------------------------------
// The subscription list
// ---------------------------------------------------------------------------

export function subscriptionRow({ name, relation, start = '01-02-2024', next = '24-11-2026', end = '', per = 'M', excl = '10,00', incl = '12,10', perMonth = excl, paused = false, mail = true, post = false }) {
  return `<tr>
  <td class="icon-v1 pad"><app-condition-container><div class="grid-multi-check"><input type="checkbox"><span></span></div></app-condition-container></td>
  <td class="icon-v1 pad"><span title="Verwijderen"></span></td>
  <td class="icon-v1 pad"><app-target-link><a class="eb-icon-edit" title="Wijzigen" href="/facturen/abonnement/1"></a></app-target-link></td>
  <td> ${name} </td><td><app-grid-inline-menu><a class="label"> ${relation} </a></app-grid-inline-menu></td>
  <td class="dateColumn"> ${start} </td><td class="dateColumn"><div style="color: ${paused ? 'rgb(170, 170, 170)' : 'black'};"> ${next} </div></td>
  <td class="dateColumn"> ${end} </td><td> ${per} </td>
  <td class="numberColumn"> ${excl} </td><td class="numberColumn"> ${incl} </td><td class="numberColumn"> ${perMonth} </td>
  <td>${post ? '<span title="Factuur per reguliere post versturen" class="eb-icon-print"></span>' : ''}</td><td>${mail ? '<span title="Factuur per e-mail versturen" class="eb-icon-mail"></span>' : ''}</td><td></td></tr>`;
}

export function subscriptionListHtml(rows) {
  const labels = ['Abonnement', 'Relatie', 'Startdatum ', 'Prolongatie ', 'Einddatum', 'Per', 'Bedrag excl', 'Bedrag incl', 'Bedrag ex p/m', '', '', ''];
  return `<!doctype html><html><head></head><body>${identity}<app-notification-bar></app-notification-bar>
  <div id="content"><app-abonnement-list>
  <div class="middle-top-container"><app-form><form class="form"><div class="form-header">Abonnementen zoeken</div><div class="form-body">
    ${checkbox('verlopenAbonnementen', 'Ook zoeken in verlopen abonnementen')}${checkbox('achterstand', 'Alleen weergeven met achterstand')}
  </div><div class="form-footer"><div class="form-buttons"><button type="submit" class="button form-submit">Zoeken</button></div></div></form></app-form></div>
  <div class="middle-bottom-container"><app-target-link><a class="plain-btn eb-s-icon-right" href="/facturen/abonnement/0"><app-icon></app-icon> Toevoegen </a></app-target-link></div>
  <div class="grid-container"><app-grid><app-grid-header><div class="grid-header"><div><div class="grid-header-title"> Abonnementen <span> (${rows.length} regels) </span></div></div></div></app-grid-header>
  <app-grid-body><div class="grid-container"><table class="grid table-v1"><thead><tr><th class="multiselect icon-v1 pad"><div class="grid-multi-check"><input type="checkbox"><span></span></div></th><th></th><th></th>
  ${labels.map((label) => `<th class="header-v1"><div><div> ${label} </div></div></th>`).join('')}</tr></thead>
  <tbody>${rows.map(subscriptionRow).join('')}</tbody></table></div></app-grid-body>
  <app-grid-footer><div class="grid-footer"><app-pagination></app-pagination><app-grid-bulk-actions><div class="grid-bulk-actions"><div><ul>
  <app-grid-bulk-action><li><span>Geselecteerde regels verwijderen</span></li></app-grid-bulk-action><app-grid-bulk-action><li><span>Geselecteerde regels wijzigen</span></li></app-grid-bulk-action>
  </ul></div></div></app-grid-bulk-actions></div></app-grid-footer></app-grid></div>
  </app-abonnement-list></div></body></html>`;
}

// ---------------------------------------------------------------------------
// The edit forms with their line list
// ---------------------------------------------------------------------------

function lineList(lines) {
  const head = '<tr><th></th><th></th><th class="numberColumn"> Aantal </th><th> Eenheid </th><th> Code </th><th> Omschrijving </th><th class="numberColumn"> P.p.e. </th><th class="numberColumn"> Korting </th><th class="numberColumn"> Bedrag excl </th><th class="textColumn"> Btw </th></tr>';
  const rows = lines.map((line) => `<tr><td class="icon-v1 pad"><app-target-link><a class="eb-icon-edit" title="Wijzigen"></a></app-target-link></td><td class="icon-v1 pad"><span title="Verwijderen"></span></td>
    <td class="numberColumn"> ${line.qty} </td><td></td><td></td><td class="multilineColumn"> ${line.text} </td><td class="numberColumn"> ${line.price} </td><td></td><td class="numberColumn"> ${line.excl} </td><td class="textColumn"> ${line.vat} </td></tr>`).join('');
  return `<app-factuurregel-list><app-grid><app-grid-body><div class="grid-container"><table class="grid table-v1"><thead>${head}</thead><tbody>${rows}</tbody>
  <tbody><tr><td colspan="10"><app-btw-totals><table><tbody>
    <tr class="totaal-excl-btw-line"><td class="td-0"></td><td class="td-1"></td><td class="td-2">Totaal excl. btw</td><td class="td-3"> 2.880,00 </td></tr>
    <tr class="btw-line"><td>Btw laag 9%</td><td>over</td><td> 2.850,00 </td><td> 256,50 </td></tr>
    <tr class="btw-line"><td>Btw hoog 21%</td><td>over</td><td> 30,00 </td><td> 6,30 </td></tr>
    <tr class="btw-line"><td></td><td></td><td>Totaal btw</td><td> 262,80 </td></tr>
    <tr class="totaal-incl-btw-line"><td></td><td></td><td>Totaal incl. btw</td><td> 3.142,80 </td></tr>
  </tbody></table></app-btw-totals></td></tr></tbody></table></div></app-grid-body></app-grid>
  <div class="center-block"><p><a class="plain-btn eb-s-icon-right"><app-icon></app-icon> Product/dienst toevoegen </a></p></div></app-factuurregel-list>`;
}

export const LINES = [
  { qty: '1', text: 'Management fee oktober', price: '2.850,00', excl: '2.850,00', vat: 'Btw laag 9%' },
  { qty: '3', text: 'Licentie per gebruiker', price: '10,00', excl: '30,00', vat: 'Btw hoog 21%' },
];

// app-form: its <form> with a header, the projected rows in .form-body and
// its footer (div.hr, the buttons, div.clear).
const footer = '<div class="form-footer"><div class="hr"></div><div class="form-buttons"><div class="form-submit"><button type="submit" class="button form-submit">Opslaan</button></div><div class="form-cancel"><button type="button" class="button form-cancel">Annuleren</button></div><div class="clear"></div></div></div>';

// The invoice form (app-factuur-form) as its template renders it. advanced:
// e-Boekhouden's "Meer opties"; off, the rows outside its simpleFields carry
// custom-hidden="true". incassoModule: the factuur-incasso block (machtiging,
// IBAN, t.n.v., plaats, omschrijving regels 1 tot 3). peppol: its checkbox.
export function invoiceEditHtml(lines = LINES, { advanced = true, incassoModule = true, peppol = false } = {}) {
  const a = { advanced };
  const off = { advanced, simple: false };
  const incasso = incassoModule ? `<div custom-hidden="false"><div class="hr"></div>
      ${row(`${label('machtigingSoort', 'Soort machtiging')}${select('machtigingSoort', [['E', 'SEPA éénmalige machtiging'], ['D', 'SEPA doorlopende machtiging']], 'D')}`)}
      ${row(`${label('machtigingId', 'Kenmerk machtiging(ID)')}${text('machtigingId')}`)}
      ${row(`${label('machtigingDatum', 'Datum ondertekening')}${datePicker('machtigingDatum')}`)}<div class="hr"></div>
      ${row(`${label('iban', 'IBAN')}${text('iban')}`)}${row(`${label('tenNameVan', 'T.n.v.')}${text('tenNameVan')}`)}${row(`${label('plaats', 'Plaats')}${text('plaats')}`)}
      ${row(`${label('factOm1', 'Omschrijving regel 1')}${text('factOm1', 'Factuur: [FACTUUR]')}`)}${row(`${label('factOm2', 'Omschrijving regel 2')}${text('factOm2')}`)}${row(`${label('factOm3', 'Omschrijving regel 3')}${text('factOm3')}`)}
    </div>` : '';
  return `<!doctype html><html><head><style>[custom-hidden="true"] { display: none !important; }</style></head><body>${identity}<app-notification-bar></app-notification-bar>
  <div id="content"><app-factuur-form><div><div class="middle-top-container"><app-goback><a id="goback">Terug</a></app-goback></div>
  <app-form class="form" custom-hidden="false"><form class="form"><div class="form-header form-header-custom"><div formheader="" class="form-header-w"><h1 class="f-h"> Factuur toevoegen </h1><div class="form-options"><span class="a-label">Meer opties</span><i class="a-icon"></i></div></div></div>
  <div class="form-body">
    ${row(`${label('relatieId', 'Relatie')}${autocomplete('relatieId', 'DEMO Demo Klant B.V.', { add: true })}`, a)}
    ${row(`${label('nummer', 'Factuurnummer')}${text('nummer', 'VB-F000000234')}<span class="float-right">${label('inEx', 'Deze factuur is')}${select('inEx', [['EX', 'Excl btw'], ['IN', 'Incl btw']], 'EX')}</span>`, off)}
    ${row(`${label('datum', 'Factuurdatum')}${datePicker('datum', '29-10-2026')}`, a)}
    ${row(`${label('kenmerk', 'Uw kenmerk')}${text('kenmerk')}`, off)}
    ${row(`${label('termijn', 'Betalingstermijn')}<app-number-input><div class="form-control"><input type="text" class="form-input" id="termijn" value="14"></div></app-number-input><label>&nbsp;dagen</label>`, off)}
    ${row(`${label('uitersteBetaaldatum', 'Uiterste betaaldatum')}${datePicker('uitersteBetaaldatum', '12-11-2026')}`, off)}
    ${row(`${label('factuurtekst', 'Factuurtekst')}<app-textarea-input><div class="form-control"><textarea class="form-input" id="factuurtekst"></textarea></div></app-textarea-input>`, a)}
    ${row(`${label('factuursjabloonId', 'Factuursjabloon')}${select('factuursjabloonId', [['1', 'Factuursjabloon']], '1')}`, a)}
    ${row(`${label('emailsjabloonId', 'E-mailsjabloon')}${select('emailsjabloonId', [['2', 'Factuur']], '2')}`, a)}
    ${row(`<app-form-label></app-form-label>${check('incasso', 'Factuurbedrag incasseren')}`, a)}
    ${incasso}
    <div${hidden(!advanced)}>${row(`<app-form-label></app-form-label>${check('directVerwerken', 'Factuur direct verwerken in de boekhouding', true)}`)}${row(`${label('mutOmschrijving', 'Mutatie-omschrijving')}${text('mutOmschrijving')}`)}</div>
    <h4 class="title-group"> Verzendwijze </h4>
    ${row(`<app-form-label></app-form-label>${check('printen', 'Factuur per reguliere post versturen')}`, off)}
    ${row(`<app-form-label></app-form-label>${check('emailen', 'Factuur per e-mail versturen', true)}`, off)}
    ${peppol ? `<div>${row(`<app-form-label></app-form-label>${check('versturenViaPeppol', 'Factuur via Peppol versturen')}`)}</div>` : ''}
    <h4 class="title-group"> Producten / Diensten </h4>${lineList(lines)}
  </div>${footer}</form></app-form><div id="infoDiv"></div></div></app-factuur-form></div></body></html>`;
}

// The subscription form (app-abonnement-form): app-form is its root, with
// e-Boekhouden's standard header.
export function subscriptionEditHtml(lines = LINES.slice(1), { incassoModule = false, peppol = false } = {}) {
  const incasso = incassoModule ? `<div><div><hr class="line-color"></div>
      ${row(`${label('machtigingSoort', 'Soort machtiging')}${select('machtigingSoort', [['E', 'SEPA éénmalige machtiging'], ['D', 'SEPA doorlopende machtiging']], 'D')}`)}
      ${row(`${label('machtigingId', 'Kenmerk machtiging(ID)')}${text('machtigingId')}`)}${row(`${label('machtigingDatum', 'Datum ondertekening')}${datePicker('machtigingDatum')}`)}<div><hr class="line-color"></div>
      ${row(`${label('iban', 'IBAN')}${text('iban')}`)}${row(`${label('tenNameVan', 'T.n.v.')}${text('tenNameVan')}`)}${row(`${label('plaats', 'Plaats')}${text('plaats')}`)}
      ${row(`${label('factOm1', 'Omschrijving regel 1')}${text('factOm1')}`)}${row(`${label('factOm2', 'Omschrijving regel 2')}${text('factOm2')}`)}${row(`${label('factOm3', 'Omschrijving regel 3')}${text('factOm3')}`)}
    </div>` : '';
  const info = '<span class="float-right pad-info"><app-form-info><span class="info"></span></app-form-info></span>';
  return `<!doctype html><html><head></head><body>${identity}<app-notification-bar></app-notification-bar>
  <div id="content"><app-abonnement-form><div class="middle-top-container"><app-goback><a id="goback">Terug</a></app-goback></div>
  <app-form><form class="form"><div class="form-header"><div class="form-header-left"><h1> Abonnement wijzigen </h1></div></div><div class="form-body">
    ${row(`${label('relatieId', 'Relatie')}${autocomplete('relatieId', 'STUDIO Studio Noord', { add: true })}`)}
    ${row(`${label('nummer', 'Naam abonnement')}${text('nummer', 'Licenties')}<span class="float-right">${label('inEx', 'Deze factuur is')}${select('inEx', [['EX', 'Excl btw'], ['IN', 'Incl btw']], 'EX')}</span>`)}
    ${row(`${label('startDatum', 'Startdatum')}${datePicker('startDatum', '01-02-2024')}`)}
    ${row(`${label('expiratieDatum', 'Prolongatiedatum')}${datePicker('expiratieDatum', '31-01-2027')}${info}`)}
    ${row(`${label('eindDatum', 'Einddatum')}${datePicker('eindDatum')}${info}`)}
    ${row(`${label('per', 'Betaling per')}${select('per', [['M', 'Maand'], ['2M', '2 maanden'], ['K', 'Kwartaal'], ['H', 'Halfjaar'], ['J', 'Jaar'], ['2J', '2 jaar'], ['W', 'Week'], ['2W', '2 weken'], ['4W', '4 weken']], 'M')}`)}
    ${row(`${label('termijn', 'Betalingstermijn')}<app-number-input><div class="form-control"><input type="text" class="form-input" id="termijn" value="14"></div></app-number-input><label>&nbsp;dagen</label>`)}
    ${row(`<app-form-label><label for="kenmerk"> Uw kenmerk <i>(optioneel)</i></label></app-form-label>${text('kenmerk')}`)}
    ${row(`${label('opmerking', 'Opmerkingen')}<app-textarea-input><div class="form-control"><textarea class="form-input" id="opmerking"></textarea></div></app-textarea-input>`)}
    ${row(`${label('factuursjabloonId', 'Factuursjabloon')}${select('factuursjabloonId', [['1', 'Factuursjabloon']], '1')}`)}
    ${row(`${label('emailsjabloonId', 'E-mailsjabloon')}${select('emailsjabloonId', [['2', 'Factuur']], '2')}`)}
    ${row(`<app-form-label></app-form-label>${check('incasso', 'Factuurbedrag incasseren')}`)}
    ${incasso}
    <h4 class="title-group">Acties</h4>
    ${row(`<app-form-label></app-form-label>${check('geenFactuur', 'Tijdelijk niet factureren')}`)}
    ${row(`<app-form-label></app-form-label>${check('autoVerwerk', 'Automatisch factureren, verwerken en versturen', true)}`)}
    ${row(`<app-form-label></app-form-label>${check('printen', 'Per post versturen')}`)}
    ${row(`<app-form-label></app-form-label>${check('emailen', 'Per e-mail versturen', true)}`)}
    ${peppol ? `<div>${row(`<app-form-label></app-form-label>${check('versturenViaPeppol', 'Factuur via Peppol versturen')}`)}</div>` : ''}
    <h4 class="title-group"> Producten / Diensten </h4>${lineList(lines)}
  </div>${footer}</form></app-form></app-abonnement-form></div></body></html>`;
}

// e-Boekhouden's line window: opened by its list, with two autocompletes.
// Opening one (mousedown) renders its rows; a row click picks it.
export function openLineWindow(document, { add = true, vat = 'Btw laag 9%', ledger = '0100 Deelneming Voorbeeld', uitleg = false, artikelen = true, eenheid = true, korting = true, btwPlichtig = true } = {}) {
  const list = document.querySelector('app-factuurregel-list');
  const overlay = document.createElement('app-form-overlay');
  const r = (body, extra = '') => `<div class="form-row${extra}"><div class="form-component">${body}</div></div>`;
  const number = (id, value = '') => `<app-number-input><div class="form-control" style="width: 80px;"><input type="text" class="form-input" id="${id}" value="${value}" autocomplete=""></div></app-number-input>`;
  // e-Boekhouden's line form (app-factuurregel-form) with its app-form:
  // the rows go into .form-body, "Opslaan en nieuw" (footerEnd) into the footer.
  overlay.innerHTML = `<div class="overlay overlay-scroll overlayBody"><div class="overlay-outer"><div class="overlay-center"><div class="overlay-inner pad-top pad-right pad-bottom pad-left" style="min-width: 600px; min-height: 116px;">
  <div class="close-div"><a class="close-btn">×</a><br></div><div class="no-top-margin"><app-factuurregel-form><div><app-form><form class="form">
  <div class="form-header"><div class="form-header-left"><h1>${add ? 'Product/dienst toevoegen' : 'Product/dienst wijzigen'}</h1></div></div><div class="form-body">
    <div${artikelen ? '' : ' custom-hidden="true"'}><div class="form-component"><span class="paddingLeft"> Selecteer hier een product of dienst of voer hieronder een nieuwe in. </span></div><br>
      ${r(`<app-form-label><label for="artikelId">Product/dienst</label></app-form-label>${autocomplete('artikelId')}`)}<br><br></div>
    ${r(`<app-form-label><label for="aantal">Aantal</label></app-form-label>${number('aantal', '1')}`)}
    ${eenheid ? r(`<app-form-label><label for="eenheidId">Eenheid</label></app-form-label>${autocomplete('eenheidId', 'stuk', { add: true })}`) : ''}
    ${r(`<app-form-label><label for="code">Code</label></app-form-label>${text('code')}`)}
    ${r(`<app-form-label><label for="omschrijving">Omschrijving</label></app-form-label><app-textarea-input><div class="form-control"><textarea class="form-input" id="omschrijving" rows="5" cols="68">Nieuwe regel</textarea></div></app-textarea-input>`)}
    ${r(`<app-form-label><label for="prijsExcl"> Prijs per eenheid </label></app-form-label>${number('prijsExcl', '25,00')}${btwPlichtig ? `<app-form-label><label for="prijsExcl">(excl btw)</label></app-form-label>${number('prijsIncl', '30,25')}<app-form-label><label for="prijsIncl">(incl btw)</label></app-form-label>` : ''}`, ' block')}
    ${btwPlichtig ? r(`<app-form-label><label for="btw">Btw percentage</label></app-form-label>${autocomplete('btw', vat)}`) : ''}
    ${korting ? r(`<app-form-label><label for="korting">Korting</label></app-form-label>${number('korting')}<app-form-label id="kortingSoort"><label for="kortingSoort"></label></app-form-label>${select('kortingSoort', [['bd', 'Bedrag'], ['perc', 'Percentage']], 'perc')}`) : ''}
    ${r(`<app-form-label><label for="grootboekrekeningId">Tegenrekening</label></app-form-label>${autocomplete('grootboekrekeningId', ledger, { add: true })}`)}
    <br><br>
    ${r(`<app-form-label></app-form-label>${check('opslaanAlsStandaard', 'Opslaan als standaard product/dienst')}`)}
  </div><div class="form-footer"><div class="hr"></div><div class="form-buttons"><div class="form-submit"><button type="submit" class="button form-submit">Opslaan</button></div><div footerend="" class="footer-next"><button type="button" class="plain-btn">Opslaan en nieuw</button></div><div class="form-cancel"><button type="button" class="button form-cancel">Annuleren</button></div><div class="clear"></div></div></div>
  </form></app-form>${uitleg ? '<div class="uitleg"> U kunt in de omschrijving de periode van de factuur aangeven met [START] en [EIND]. Bijvoorbeeld: <br> Periode: [START] t/m [EIND]. De velden [START] en [EIND] worden bij het maken van de facturen automatisch vervangen door de data. </div>' : ''}</div></app-factuurregel-form></div></div></div></div></div>`;
  list.append(overlay);
  const options = {
    btw: ['Btw hoog 21%', 'Btw laag 9%', 'Geen btw'],
    grootboekrekeningId: ['0100 Deelneming Voorbeeld', '8000 Omzet dienstverlening', '8010 Omzet producten'],
  };
  for (const [name, values] of Object.entries(options)) {
    const input = overlay.querySelector(`#${name}-AutocompletePickerInput`);
    const host = input.closest('app-autocomplete');
    input.addEventListener('mousedown', () => {
      if (host.querySelector('.selector')) return;
      const selector = document.createElement('div');
      selector.className = 'selector';
      selector.id = `${name}-AutocompletePicker`;
      selector.innerHTML = `<div class="scroll-container"><table><tbody>${values.map((value, i) => `<tr class="row v1" id="${name}-AutocompletePickerRow-${i}"><td class="col">${value.split(' ')[0]}</td><td class="col">${value.split(' ').slice(1).join(' ')}</td></tr>`).join('')}</tbody></table></div>`;
      setTimeout(() => host.querySelector('.form-control').append(selector), 30);
    });
    host.addEventListener('click', (event) => {
      const row = event.target.closest('tr.row');
      if (!row) return;
      input.value = values[Number(row.id.split('-').at(-1))];
      host.querySelector('.selector')?.remove();
    });
  }
  return overlay;
}

// A page with the request layer's answers: a fetch that counts.
export function billingPage(html, { url, settings = { betterDesign: true }, store = {}, posts = [], postsStatus = 200 } = {}) {
  const p = page(html, {
    url,
    store: { settings, ...store },
    answer: (message) => (message.type === 'requests:slot' ? { ok: true, lease: `lease-${Math.random()}` } : {}),
  });
  p.fetches = [];
  p.window.fetch = async (input) => {
    p.fetches.push(String(input));
    const body = JSON.stringify({ data: posts, rowCount: posts.length });
    return { status: postsStatus, ok: postsStatus < 400, redirected: false, headers: { get: () => null }, text: async () => body };
  };
  p.slots = () => p.sent.filter((message) => message.type === 'requests:slot').length;
  p.load(...SCRIPTS);
  return p;
}

// An open post as the grid answers it (camelCase rows).
export const post = (mutFactuur, teOntvangen, vervaldatum, bedrijf = 'Demo Klant B.V.') => ({ mutFactuur, teOntvangen, vervaldatum, bedrijf, relatieId: 1 });
