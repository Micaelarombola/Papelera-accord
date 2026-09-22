
"use strict";

// PAPELERA ACCORD
// Sistema limpio: no carga productos de ejemplo.
const STORAGE_KEY = "papeleraAccordStock_v2";

const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];

const emptyData = () => ({
  products: [],
  customers: [],
  movements: [],
  sales: []
});

const uuid = () =>
  typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : `id-${Date.now()}-${Math.random().toString(36).slice(2)}`;

const esc = value =>
  String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");

const money = value =>
  new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency: "ARS",
    maximumFractionDigits: 2
  }).format(value || 0);

const dateTime = value =>
  new Intl.DateTimeFormat("es-AR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));

const dayKey = value => {
  const d = new Date(value);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

const productById = id => state.products.find(p => p.id === id);
const customerById = id => state.customers.find(c => c.id === id);

const stockStatus = p =>
  p.stock === 0 ? "out" : p.stock <= p.minStock ? "low" : "ok";

const stockBadge = p =>
  `<span class="badge ${stockStatus(p)}">${{
    out: "Sin stock",
    low: "Stock bajo",
    ok: "Disponible"
  }[stockStatus(p)]}</span>`;

const emptyRow = (n, msg) =>
  `<tr><td class="empty-cell" colspan="${n}">${esc(msg)}</td></tr>`;

let state;
let savedSnapshot;
let readonly = false;
let search = "";
let cart = [];
let selectedProductId = "";
let modalAction = null;
let toastTimer;

// VALIDACIÓN DE LOS DATOS
function validateData(data) {
  if (
    !data ||
    typeof data !== "object" ||
    !Array.isArray(data.products) ||
    !Array.isArray(data.sales) ||
    !Array.isArray(data.movements) ||
    !Array.isArray(data.customers)
  ) {
    throw Error("El respaldo no contiene todos los listados requeridos.");
  }

  const text = (v, n = 180) => String(v ?? "").slice(0, n);

  const nat = (v, label) => {
    if (!Number.isSafeInteger(v) || v < 0 || v > 1e9) {
      throw Error(`Cantidad inválida: ${label}`);
    }
    return v;
  };

  const amount = (v, label) => {
    if (
      typeof v !== "number" ||
      !Number.isFinite(v) ||
      v < 0 ||
      v > 1e12
    ) {
      throw Error(`Precio inválido: ${label}`);
    }
    return v;
  };

  const validDate = v => {
    if (
      typeof v !== "string" ||
      !Number.isFinite(Date.parse(v))
    ) {
      throw Error("Fecha inválida en el respaldo.");
    }
    return v;
  };

  const ids = new Set();
  const codes = new Set();
  const numbers = new Set();

  const id = (v, type) => {
    if (
      typeof v !== "string" ||
      !v ||
      ids.has(`${type}:${v}`)
    ) {
      throw Error(`Identificador duplicado o faltante: ${type}`);
    }
    ids.add(`${type}:${v}`);
    return text(v, 120);
  };

  const products = data.products.map(p => {
    if (
      !p ||
      typeof p !== "object" ||
      !text(p.name).trim() ||
      !text(p.category).trim() ||
      !text(p.code).trim()
    ) {
      throw Error("Producto incompleto.");
    }

    const code = text(p.code, 80).trim();
    if (codes.has(code.toLocaleLowerCase("es"))) {
      throw Error("Códigos de productos repetidos.");
    }
    codes.add(code.toLocaleLowerCase("es"));

    return {
      id: id(p.id, "producto"),
      code,
      name: text(p.name, 160),
      category: text(p.category, 100),
      stock: nat(p.stock, "stock"),
      minStock: nat(p.minStock, "mínimo"),
      price: amount(p.price, "producto")
    };
  });

  const customers = data.customers.map(c => {
    if (!c || !text(c.name).trim()) {
      throw Error("Cliente incompleto.");
    }
    return {
      id: id(c.id, "cliente"),
      name: text(c.name, 120),
      phone: text(c.phone, 40),
      email: text(c.email, 160),
      notes: text(c.notes, 400)
    };
  });

  const sales = data.sales.map(s => {
    if (
      !s ||
      !Array.isArray(s.items) ||
      !s.items.length ||
      !s.number
    ) {
      throw Error("Venta incompleta.");
    }

    const items = s.items.map(i => {
      if (!i || !text(i.name).trim()) {
        throw Error("Artículo incompleto.");
      }
      const quantity = nat(i.quantity, "venta");
      if (!quantity) {
        throw Error("Cantidad de venta inválida.");
      }
      return {
        productId: text(i.productId, 120),
        code: text(i.code, 80),
        name: text(i.name, 160),
        quantity,
        price: amount(i.price, "venta")
      };
    });

    const total = amount(s.total, "total");

    if (
      Math.abs(
        items.reduce(
          (sum, i) => sum + i.price * i.quantity,
          0
        ) - total
      ) > .011
    ) {
      throw Error("Total de venta inconsistente.");
    }

    const number = text(s.number, 80);
    if (numbers.has(number)) {
      throw Error("Números de venta duplicados.");
    }
    numbers.add(number);

    return {
      id: id(s.id, "venta"),
      number,
      date: validDate(s.date),
      customerId: text(s.customerId, 120),
      customerName: text(s.customerName, 120),
      customerPhone: text(s.customerPhone, 40),
      status: s.status === "cancelled" ? "cancelled" : "active",
      cancelledAt: s.cancelledAt ? validDate(s.cancelledAt) : "",
      items,
      total
    };
  });

  const movements = data.movements.map(m => {
    if (
      !m ||
      !["sale", "entry", "adjustment", "return"].includes(m.type)
    ) {
      throw Error("Tipo de movimiento inválido.");
    }

    const quantity = nat(m.quantity, "movimiento");
    if (!quantity) {
      throw Error("Movimiento sin cantidad.");
    }

    const delta =
      m.delta ?? (m.type === "sale" ? -quantity : quantity);

    if (
      !Number.isSafeInteger(delta) ||
      Math.abs(delta) > 1e9
    ) {
      throw Error("Ajuste inválido.");
    }

    return {
      id: id(m.id, "movimiento"),
      date: validDate(m.date),
      type: m.type,
      productId: text(m.productId, 120),
      productCode: text(m.productCode, 80),
      productName: text(m.productName, 160),
      quantity,
      resultStock: nat(m.resultStock, "stock resultante"),
      detail: text(m.detail, 240),
      delta
    };
  });

  return { products, customers, movements, sales };
}

// ALMACENAMIENTO LOCAL
function loadState() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    return saved
      ? validateData(JSON.parse(saved))
      : emptyData();
  } catch (err) {
    readonly = true;
    console.error("No se pudo abrir el inventario", err);
    setTimeout(
      () => alert(
        "No se pudo leer el inventario guardado. No se modificaron los datos anteriores. Restaurá un respaldo desde Respaldos."
      ),
      0
    );
    return emptyData();
  }
}

state = loadState();
savedSnapshot = JSON.stringify(state);

function save() {
  if (readonly) {
    toast("Primero restaurá un respaldo válido en Respaldos.", true);
    return false;
  }

  try {
    const next = JSON.stringify(state);
    localStorage.setItem(STORAGE_KEY, next);
    savedSnapshot = next;
    return true;
  } catch (err) {
    console.error(err);
    state = JSON.parse(savedSnapshot);
    render();
    renderCart();
    toast(
      "No se pudo guardar. Revisá los permisos o el espacio del navegador.",
      true
    );
    return false;
  }
}

// NOTIFICACIONES Y CONFIRMACIONES
function toast(message, error = false) {
  const node = $("#toast");
  node.textContent = message;
  node.classList.toggle("error", error);
  node.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(
    () => node.classList.remove("show"),
    3600
  );
}

function confirmAction(message, action) {
  modalAction = action;
  $("#confirmMessage").textContent = message;
  $("#confirmModal").classList.remove("hidden");
  $("#confirmModal").setAttribute("aria-hidden", "false");
}

function closeModal() {
  modalAction = null;
  $("#confirmModal").classList.add("hidden");
  $("#confirmModal").setAttribute("aria-hidden", "true");
}

// NAVEGACIÓN
function nav(section) {
  if (
    !document.getElementById(section)?.classList.contains("page-section")
  ) {
    return;
  }

  $$(".page-section").forEach(s =>
    s.classList.toggle("active", s.id === section)
  );

  $$(".nav-item").forEach(b =>
    b.classList.toggle("active", b.dataset.section === section)
  );

  window.scrollTo({ top: 0, behavior: "instant" });
}

// MOVIMIENTOS
function movement(
  product,
  type,
  qty,
  detail,
  delta = type === "sale" ? -qty : qty
) {
  return {
    id: uuid(),
    date: new Date().toISOString(),
    type,
    productId: product.id,
    productCode: product.code,
    productName: product.name,
    quantity: qty,
    resultStock: product.stock,
    detail,
    delta
  };
}

function badgeMove(type) {
  return `<span class="badge ${type}">${
    {
      sale: "Venta",
      entry: "Entrada",
      adjustment: "Ajuste",
      return: "Devolución"
    }[type] || esc(type)
  }</span>`;
}

function moveQty(m) {
  return `${m.delta > 0 ? "+" : ""}${m.delta}`;
}

// ACTUALIZAR TODAS LAS PANTALLAS
function render() {
  renderDashboard();
  renderProductOptions();
  renderProducts();
  renderClients();
  renderClientOptions();
  renderMovements();
  renderLow();
  renderCategories();
  renderReports();
  renderSales();
  entryPreview();

  $("#firstSteps")?.classList.toggle(
    "hidden",
    state.products.length !== 0
  );
}

// INICIO / DASHBOARD
function renderDashboard() {
  const low = state.products.filter(p => p.stock <= p.minStock);
  const today = dayKey(new Date());

  $("#statProducts").textContent = state.products.length;
  $("#statLow").textContent = low.length;

  $("#statSalesToday").textContent = state.sales.filter(
    s => s.status !== "cancelled" && dayKey(s.date) === today
  ).length;

  $("#statMovementsToday").textContent = state.movements.filter(
    m => dayKey(m.date) === today
  ).length;

  $("#dashboardLowStock").innerHTML =
    low.sort((a, b) => a.stock - b.stock)
      .slice(0, 5)
      .map(p => `
        <tr>
          <td>${esc(p.name)}</td>
          <td>${p.stock}</td>
          <td>${p.minStock}</td>
          <td>${stockBadge(p)}</td>
        </tr>
      `).join("") ||
    emptyRow(4, "No hay productos pendientes de reposición.");

  $("#dashboardMovements").innerHTML =
    state.movements.slice(0, 6).map(m => `
      <tr>
        <td>${dateTime(m.date)}</td>
        <td>${badgeMove(m.type)}</td>
        <td>${esc(m.productName)}</td>
        <td class="${m.delta < 0 ? "qty-negative" : "qty-positive"}">
          ${moveQty(m)}
        </td>
        <td>${m.resultStock}</td>
      </tr>
    `).join("") ||
    emptyRow(5, "Todavía no hay movimientos.");

  const summary = categorySummary();

  const total = summary.reduce(
    (sum, c) => sum + c.units,
    0
  );

  const colors = [
    "#1575c7",
    "#55aee3",
    "#4aa33d",
    "#8acb71",
    "#9db7ca",
    "#77a6d1",
    "#c5d8e7",
    "#7fc0aa"
  ];

  $("#donutTotal").textContent = total.toLocaleString("es-AR");

  let position = 0;

  $("#categoryDonut").style.background = total
    ? `conic-gradient(${
        summary.map((c, i) => {
          const start = position;
          position += c.units / total * 100;
          return `${colors[i % colors.length]} ${start}% ${position}%`;
        }).join(",")
      })`
    : "#e8eef3";

  $("#categoryLegend").innerHTML = total
    ? summary.slice(0, 8).map((c, i) => `
        <div class="legend-row">
          <span class="legend-dot"
            style="background:${colors[i % colors.length]}"></span>
          <span>${esc(c.category)}</span>
          <strong>${Math.round(c.units / total * 100)}%</strong>
        </div>
      `).join("")
    : '<div class="empty-cell">Sin datos de categorías</div>';
}

// OPCIONES DE PRODUCTOS
function renderProductOptions() {
  const cats = [
    ...new Set(state.products.map(p => p.category))
  ].sort((a, b) => a.localeCompare(b, "es"));

  $("#categoryOptions").innerHTML = cats
    .map(c => `<option value="${esc(c)}"></option>`)
    .join("");

  const filter = $("#productCategoryFilter");
  const previous = filter.value;

  filter.innerHTML =
    '<option value="">Todas las categorías</option>' +
    cats.map(c => `
      <option value="${esc(c)}">${esc(c)}</option>
    `).join("");

  if (cats.includes(previous)) {
    filter.value = previous;
  }

  const select = $("#entryProduct");
  const selected = select.value;

  select.innerHTML =
    '<option value="">Seleccionar producto...</option>' +
    [...state.products]
      .sort((a, b) => a.name.localeCompare(b.name, "es"))
      .map(p => `
        <option value="${esc(p.id)}">
          ${esc(p.name)} — Stock: ${p.stock}
        </option>
      `).join("");

  if (productById(selected)) {
    select.value = selected;
  }
}

// LISTADO DE PRODUCTOS
function renderProducts() {
  const cat = $("#productCategoryFilter").value;
  const status = $("#productStatusFilter").value;

  const products = [...state.products]
    .filter(p =>
      (!cat || p.category === cat) &&
      (!status || stockStatus(p) === status) &&
      [p.code, p.name, p.category]
        .join(" ")
        .toLocaleLowerCase("es")
        .includes(search)
    )
    .sort((a, b) => a.name.localeCompare(b.name, "es"));

  $("#productCountText").textContent =
    `${products.length} ${
      products.length === 1 ? "producto" : "productos"
    }`;

  $("#productsTable").innerHTML =
    products.map(p => `
      <tr>
        <td><strong>${esc(p.code)}</strong></td>
        <td>${esc(p.name)}</td>
        <td>${esc(p.category)}</td>
        <td>${p.stock}</td>
        <td>${p.minStock}</td>
        <td>${stockBadge(p)}</td>
        <td>
          <button class="action-btn" type="button"
            data-product-action="edit"
            data-id="${esc(p.id)}">Editar</button>
          <button class="action-btn delete" type="button"
            data-product-action="delete"
            data-id="${esc(p.id)}">Eliminar</button>
        </td>
      </tr>
    `).join("") ||
    emptyRow(7, "No hay productos para mostrar.");
}

// LIMPIAR FORMULARIO DE PRODUCTOS
function resetProduct() {
  $("#productForm").reset();
  $("#productId").value = "";
  $("#productStock").value = 0;
  $("#productMinStock").value = 10;
  $("#productFormTitle").textContent = "Nuevo producto";
  $("#productSubmitBtn").textContent = "Guardar producto";
  $("#cancelEditBtn").classList.add("hidden");
}

// GUARDAR O EDITAR PRODUCTO
function saveProduct(event) {
  event.preventDefault();

  const id = $("#productId").value;
  const code = $("#productCode").value.trim();
  const name = $("#productName").value.trim();
  const category = $("#productCategory").value.trim();

  const stock = Number($("#productStock").value);
  const minStock = Number($("#productMinStock").value);
  const price = Number($("#productPrice").value || 0);

  if (
    !code || !name || !category ||
    code.length > 80 ||
    name.length > 160 ||
    category.length > 100
  ) {
    toast(
      "Completá código, nombre y categoría (sin exceder el largo permitido).",
      true
    );
    return;
  }

  if (
    !Number.isSafeInteger(stock) ||
    !Number.isSafeInteger(minStock) ||
    stock < 0 ||
    minStock < 0 ||
    stock > 1e9 ||
    minStock > 1e9 ||
    !Number.isFinite(price) ||
    price < 0 ||
    price > 1e12
  ) {
    toast(
      "Revisá stock, mínimo y precio. Las cantidades deben ser enteras no negativas.",
      true
    );
    return;
  }

  if (
    state.products.some(
      p =>
        p.id !== id &&
        p.code.toLocaleLowerCase("es") ===
          code.toLocaleLowerCase("es")
    )
  ) {
    toast("Ya existe un producto con ese código.", true);
    return;
  }

  if (id) {
    const p = productById(id);
    if (!p) return;

    const previous = p.stock;

    Object.assign(p, {
      code,
      name,
      category,
      stock,
      minStock,
      price
    });

    if (previous !== stock) {
      state.movements.unshift(
        movement(
          p,
          "adjustment",
          Math.abs(stock - previous),
          `Ajuste manual: ${previous} → ${stock}`,
          stock - previous
        )
      );
    }
  } else {
    const p = {
      id: uuid(),
      code,
      name,
      category,
      stock,
      minStock,
      price
    };

    state.products.push(p);

    if (stock > 0) {
      state.movements.unshift(
        movement(p, "entry", stock, "Stock inicial")
      );
    }
  }

  if (!save()) return;

  resetProduct();
  render();
  toast(id ? "Producto actualizado." : "Producto guardado.");
}

// BOTONES EDITAR Y ELIMINAR PRODUCTO
function productActions(event) {
  const btn = event.target.closest("[data-product-action]");
  if (!btn) return;

  const p = productById(btn.dataset.id);
  if (!p) return;

  if (btn.dataset.productAction === "edit") {
    $("#productId").value = p.id;

    for (const field of ["Code", "Name", "Category"]) {
      $("#product" + field).value = p[field.toLowerCase()];
    }

    $("#productStock").value = p.stock;
    $("#productMinStock").value = p.minStock;
    $("#productPrice").value = p.price;
    $("#productFormTitle").textContent = "Editar producto";
    $("#productSubmitBtn").textContent = "Guardar cambios";
    $("#cancelEditBtn").classList.remove("hidden");
    $("#productCode").focus();
    return;
  }

  confirmAction(
    `¿Eliminar “${p.name}”? Se conserva el historial de ventas y movimientos.`,
    () => {
      state.products = state.products.filter(x => x.id !== p.id);

      if (!save()) return;

      cart = cart.filter(i => i.productId !== p.id);

      if (selectedProductId === p.id) {
        clearSelectedProduct();
      }

      if ($("#productId").value === p.id) {
        resetProduct();
      }

      render();
      renderCart();
      toast("Producto eliminado.");
    }
  );
}

// BUSCAR PRODUCTOS DURANTE UNA VENTA
function findSaleProducts() {
  const term = $("#saleProductSearch")
    .value.trim()
    .toLocaleLowerCase("es");

  selectedProductId = "";
  $("#selectedSaleProduct").classList.add("hidden");
  $("#addProductToSale").disabled = true;

  const box = $("#saleSearchResults");

  if (!term) {
    box.classList.add("hidden");
    box.innerHTML = "";
    return;
  }

  const matches = state.products
    .filter(p =>
      [p.name, p.code, p.category]
        .join(" ")
        .toLocaleLowerCase("es")
        .includes(term)
    )
    .slice(0, 15);

  box.innerHTML =
    matches.map(p => `
      <button type="button" class="sale-search-result"
        data-sale-product-id="${esc(p.id)}">
        <div>
          <strong>${esc(p.name)}</strong>
          <small>${esc(p.code)} · ${esc(p.category)}</small>
        </div>
        <div class="search-product-stock ${p.stock === 0 ? "out" : ""}">
          <strong>${money(p.price)}</strong>
          <small>Stock: ${p.stock}</small>
        </div>
      </button>
    `).join("") ||
    '<div class="empty-cell">No encontramos productos.</div>';

  box.classList.remove("hidden");
}

// SELECCIONAR PRODUCTO PARA LA VENTA
function selectSaleProduct(id) {
  const p = productById(id);
  if (!p) return;

  selectedProductId = id;
  $("#saleProductSearch").value = p.name;
  $("#saleSearchResults").classList.add("hidden");
  $("#selectedSaleProduct").classList.remove("hidden");
  $("#selectedSaleProductName").textContent = p.name;
  $("#selectedSaleProductInfo").textContent =
    `Código: ${p.code} · Stock disponible: ${p.stock}`;
  $("#selectedSaleProductPrice").textContent = money(p.price);
  $("#saleProductQuantity").value = 1;
  $("#addProductToSale").disabled = p.stock < 1;
}

function clearSelectedProduct() {
  selectedProductId = "";
  $("#saleProductSearch").value = "";
  $("#selectedSaleProduct").classList.add("hidden");
  $("#saleSearchResults").classList.add("hidden");
  $("#addProductToSale").disabled = true;
  $("#saleProductQuantity").value = 1;
}

// AGREGAR AL CARRITO
function addToCart() {
  const p = productById(selectedProductId);
  const qty = Number($("#saleProductQuantity").value);

  if (!p) {
    toast("Seleccioná un producto.", true);
    return;
  }

  if (!Number.isSafeInteger(qty) || qty <= 0) {
    toast("Ingresá una cantidad entera mayor que cero.", true);
    return;
  }

  const current = cart.find(i => i.productId === p.id);

  if (qty + (current?.quantity || 0) > p.stock) {
    toast(`Stock insuficiente. Disponible: ${p.stock}.`, true);
    return;
  }

  if (current) {
    current.quantity += qty;
  } else {
    cart.push({
      productId: p.id,
      code: p.code,
      name: p.name,
      price: p.price,
      quantity: qty
    });
  }

  clearSelectedProduct();
  renderCart();
  $("#saleProductSearch").focus();
  toast("Producto agregado a la venta.");
}

// MOSTRAR CARRITO
function renderCart() {
  const has = cart.length > 0;

  $("#emptySaleCart").classList.toggle("hidden", has);
  $("#saleCartTableWrapper").classList.toggle("hidden", !has);
  $("#finishSaleButton").disabled = !has;

  const units = cart.reduce(
    (n, i) => n + i.quantity,
    0
  );

  $("#saleItemsCount").textContent =
    `${units} ${units === 1 ? "producto" : "productos"}`;

  $("#saleCartTable").innerHTML = cart.map(i => `
    <tr>
      <td class="cart-product-name">
        <strong>${esc(i.name)}</strong>
        <small>${esc(i.code)}</small>
      </td>
      <td>
        <input class="cart-quantity-input"
          type="number" min="1" step="1"
          value="${i.quantity}"
          data-cart-qty="${esc(i.productId)}"
          aria-label="Cantidad de ${esc(i.name)}">
      </td>
      <td>${money(i.price)}</td>
      <td><strong>${money(i.price * i.quantity)}</strong></td>
      <td>
        <button type="button" class="remove-cart-item"
          data-cart-remove="${esc(i.productId)}"
          title="Quitar">×</button>
      </td>
    </tr>
  `).join("");

  const total = cart.reduce(
    (sum, i) => sum + i.quantity * i.price,
    0
  );

  $("#saleSubtotal").textContent = money(total);
  $("#saleTotal").textContent = money(total);
}

// QUITAR PRODUCTO DEL CARRITO
function cartAction(event) {
  const btn = event.target.closest("[data-cart-remove]");
  if (!btn) return;

  cart = cart.filter(
    i => i.productId !== btn.dataset.cartRemove
  );

  renderCart();
}

// MODIFICAR CANTIDAD EN CARRITO
function cartQuantity(event) {
  const input = event.target.closest("[data-cart-qty]");
  if (!input) return;

  const i = cart.find(
    i => i.productId === input.dataset.cartQty
  );

  const p = productById(input.dataset.cartQty);
  const qty = Number(input.value);

  if (!i || !p) return;

  if (
    !Number.isSafeInteger(qty) ||
    qty < 1 ||
    qty > p.stock
  ) {
    toast(`Cantidad inválida. Disponible: ${p.stock}.`, true);
    input.value = i.quantity;
    return;
  }

  i.quantity = qty;
  renderCart();
}

// VACIAR CARRITO
function clearCart() {
  if (cart.length) {
    confirmAction(
      "¿Vaciar todos los productos de esta venta sin registrar movimientos?",
      () => {
        cart = [];
        renderCart();
        toast("Carrito vaciado.");
      }
    );
  }
}

// NUMERACIÓN DE VENTAS
function saleNumber() {
  const max = state.sales.reduce((n, s) => {
    const m = /^VENTA-(\d+)$/.exec(s.number);
    return m ? Math.max(n, Number(m[1])) : n;
  }, 0);

  return `VENTA-${String(max + 1).padStart(6, "0")}`;
}

// FINALIZAR UNA VENTA
function finishSale() {
  if (!cart.length) {
    toast("Agregá productos a la venta.", true);
    return;
  }

  for (const item of cart) {
    const p = productById(item.productId);

    if (
      !p ||
      !Number.isSafeInteger(item.quantity) ||
      item.quantity < 1 ||
      p.stock < item.quantity
    ) {
      toast(
        `No hay stock suficiente de ${item.name}. Revisá el carrito.`,
        true
      );
      return;
    }
  }

  const name =
    $("#saleClientName").value.trim() || "Consumidor final";

  const phone = $("#saleClientPhone").value.trim();

  if (name.length > 120 || phone.length > 40) {
    toast("Revisá los datos del cliente.", true);
    return;
  }

  let customerId = "";

  if (name !== "Consumidor final") {
    let c = customerById($("#saleClientSelect").value);

    if (!c || c.name !== name) {
      c = state.customers.find(c =>
        c.name.toLocaleLowerCase("es") ===
          name.toLocaleLowerCase("es") &&
        (!phone || !c.phone || c.phone === phone)
      );
    }

    if (!c) {
      c = {
        id: uuid(),
        name,
        phone,
        email: "",
        notes: ""
      };
      state.customers.push(c);
    }

    customerId = c.id;
  }

  const number = saleNumber();
  const items = cart.map(i => ({ ...i }));

  const sale = {
    id: uuid(),
    number,
    date: new Date().toISOString(),
    customerId,
    customerName: name,
    customerPhone: phone,
    status: "active",
    cancelledAt: "",
    items,
    total: items.reduce(
      (sum, i) => sum + i.quantity * i.price,
      0
    )
  };

  for (const item of items) {
    const p = productById(item.productId);
    p.stock -= item.quantity;

    state.movements.unshift(
      movement(
        p,
        "sale",
        item.quantity,
        `${number} · ${name}`
      )
    );
  }

  state.sales.unshift(sale);

  if (!save()) return;

  cart = [];
  clearSelectedProduct();
  $("#saleClientName").value = "";
  $("#saleClientPhone").value = "";
  $("#saleClientSelect").value = "";

  render();
  renderCart();
  saleCompleted(sale);
}

// MENSAJE DE VENTA TERMINADA
function saleCompleted(sale) {
  const prior = $("#saleCompletedModal");
  if (prior) prior.remove();

  const modal = document.createElement("div");
  modal.id = "saleCompletedModal";
  modal.className = "modal";

  modal.innerHTML = `
    <div class="modal-backdrop" data-finish-close></div>
    <div class="modal-card" role="dialog" aria-modal="true">
      <h3>✅ Venta registrada</h3>
      <p>
        ${esc(sale.number)} · Total:
        <strong>${money(sale.total)}</strong>
      </p>
      <div class="modal-actions">
        <button type="button" class="btn secondary"
          data-finish-close>Cerrar</button>
        <button type="button" class="btn primary"
          id="printCompletedSale">🖨️ Imprimir ticket</button>
      </div>
    </div>
  `;

  document.body.appendChild(modal);

  modal.querySelectorAll("[data-finish-close]").forEach(b =>
    b.addEventListener("click", () => modal.remove())
  );

  modal.querySelector("#printCompletedSale")
    .addEventListener("click", () => printTicket(sale));
}

// TICKET IMPRIMIBLE
function printTicket(sale) {
  const win = window.open(
    "",
    "_blank",
    "width=510,height=760"
  );

  if (!win) {
    toast(
      "El navegador bloqueó el ticket. Permití ventanas emergentes para imprimir.",
      true
    );
    return;
  }

  const rows = sale.items.map(i => `
    <tr>
      <td>
        ${esc(i.name)}
        <small>${esc(i.code)}</small>
      </td>
      <td>${i.quantity}</td>
      <td>${money(i.price)}</td>
      <td>${money(i.price * i.quantity)}</td>
    </tr>
  `).join("");

  win.document.open();

  win.document.write(`
    <!doctype html>
    <html lang="es">
    <head>
      <meta charset="utf-8">
      <title>${esc(sale.number)}</title>
      <style>
        body {
          font:13px Arial,sans-serif;
          color:#111;
          max-width:450px;
          margin:20px auto;
          padding:12px;
        }
        header {
          text-align:center;
          border-bottom:1px dashed #888;
          padding:15px;
        }
        h1 {
          color:#0d477f;
          margin:0;
          font-size:23px;
        }
        small {
          display:block;
          color:#555;
          font-size:10px;
          margin-top:3px;
        }
        table {
          width:100%;
          border-collapse:collapse;
          margin-top:20px;
        }
        th,td {
          text-align:left;
          border-bottom:1px solid #ddd;
          padding:8px 3px;
          font-size:11px;
        }
        th:last-child,td:last-child {
          text-align:right;
        }
        .total {
          display:flex;
          justify-content:space-between;
          font-size:20px;
          font-weight:bold;
          border-top:2px dashed #222;
          margin-top:25px;
          padding-top:15px;
        }
        .no-print {
          text-align:center;
          margin:25px;
        }
        .no-print button {
          padding:12px;
          border:0;
          background:#0d477f;
          color:white;
          border-radius:8px;
        }
        @media print {
          .no-print { display:none; }
          body { margin:0;max-width:none; }
        }
      </style>
    </head>
    <body>
      <header>
        <h1>PAPELERA ACCORD</h1>
        <p>
          Comprobante interno de venta<br>
          <small>No válido como factura fiscal</small>
        </p>
      </header>

      <p>
        <strong>${esc(sale.number)}</strong><br>
        Fecha: ${dateTime(sale.date)}<br>
        Cliente: ${esc(sale.customerName)}
        ${sale.customerPhone
          ? `<br>Teléfono: ${esc(sale.customerPhone)}`
          : ""}
        <br>
        Estado:
        ${sale.status === "cancelled" ? "ANULADA" : "Confirmada"}
      </p>

      <table>
        <thead>
          <tr>
            <th>Producto</th>
            <th>Cant.</th>
            <th>Precio</th>
            <th>Subtotal</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>

      <div class="total">
        <span>TOTAL</span>
        <span>${money(sale.total)}</span>
      </div>

      <p style="text-align:center;margin-top:30px">
        ¡Gracias por tu compra!
      </p>

      <div class="no-print">
        <button onclick="window.print()">Imprimir ticket</button>
      </div>
    </body>
    </html>
  `);

  win.document.close();
  win.focus();
}

// SELECTOR DE CLIENTES EN VENTAS
function renderClientOptions() {
  const select = $("#saleClientSelect");
  const old = select.value;

  select.innerHTML =
    '<option value="">Consumidor final / ingresar nuevo</option>' +
    [...state.customers]
      .sort((a, b) => a.name.localeCompare(b.name, "es"))
      .map(c => `
        <option value="${esc(c.id)}">
          ${esc(c.name)}${c.phone ? " · " + esc(c.phone) : ""}
        </option>
      `).join("");

  if (customerById(old)) {
    select.value = old;
  }
}

function selectClient() {
  const c = customerById($("#saleClientSelect").value);
  $("#saleClientName").value = c?.name || "";
  $("#saleClientPhone").value = c?.phone || "";
}

// GUARDAR CLIENTE DESDE LA PANTALLA DE VENTAS
function saveClientFromSale() {
  const name = $("#saleClientName").value.trim();
  const phone = $("#saleClientPhone").value.trim();

  if (!name || name.length > 120 || phone.length > 40) {
    toast(
      "Ingresá el nombre del cliente y revisá los datos.",
      true
    );
    return;
  }

  let c =
    customerById($("#saleClientSelect").value) ||
    state.customers.find(x =>
      x.name.toLocaleLowerCase("es") ===
        name.toLocaleLowerCase("es") &&
      x.phone === phone
    );

  if (c) {
    if (
      state.customers.some(x =>
        x.id !== c.id &&
        x.name.toLocaleLowerCase("es") ===
          name.toLocaleLowerCase("es") &&
        x.phone === phone
      )
    ) {
      toast("Ya existe ese cliente.", true);
      return;
    }

    Object.assign(c, { name, phone });
  } else {
    c = {
      id: uuid(),
      name,
      phone,
      email: "",
      notes: ""
    };
    state.customers.push(c);
  }

  if (!save()) return;

  render();
  $("#saleClientSelect").value = c.id;
  toast("Cliente guardado en la agenda.");
}

// FORMULARIO DE CLIENTES
function resetClient() {
  $("#customerForm").reset();
  $("#customerId").value = "";
  $("#customerFormTitle").textContent = "Nuevo cliente";
  $("#customerSubmitBtn").textContent = "Guardar cliente";
  $("#cancelCustomerEdit").classList.add("hidden");
}

// GUARDAR O EDITAR CLIENTE
function saveClient(event) {
  event.preventDefault();

  const id = $("#customerId").value;
  const name = $("#customerName").value.trim();
  const phone = $("#customerPhone").value.trim();
  const email = $("#customerEmail").value.trim();
  const notes = $("#customerNotes").value.trim();

  if (
    !name ||
    name.length > 120 ||
    phone.length > 40 ||
    email.length > 160 ||
    notes.length > 400
  ) {
    toast("Revisá los datos del cliente.", true);
    return;
  }

  if (
    state.customers.some(c =>
      c.id !== id &&
      c.name.toLocaleLowerCase("es") ===
        name.toLocaleLowerCase("es") &&
      c.phone === phone
    )
  ) {
    toast("El cliente ya existe.", true);
    return;
  }

  if (id) {
    const c = customerById(id);
    if (!c) return;

    Object.assign(c, {
      name,
      phone,
      email,
      notes
    });
  } else {
    state.customers.push({
      id: uuid(),
      name,
      phone,
      email,
      notes
    });
  }

  if (!save()) return;

  resetClient();
  render();
  toast(id ? "Cliente actualizado." : "Cliente guardado.");
}

// LISTADO DE CLIENTES
function renderClients() {
  const term = $("#customerSearch")
    .value.trim()
    .toLocaleLowerCase("es");

  const items = [...state.customers]
    .filter(c =>
      [c.name, c.phone, c.email]
        .join(" ")
        .toLocaleLowerCase("es")
        .includes(term)
    )
    .sort((a, b) => a.name.localeCompare(b.name, "es"));

  $("#customerCountText").textContent =
    `${items.length} ${
      items.length === 1 ? "cliente" : "clientes"
    }`;

  $("#customersTable").innerHTML =
    items.map(c => `
      <tr>
        <td><strong>${esc(c.name)}</strong></td>
        <td>${esc(c.phone || "—")}</td>
        <td>${esc(c.email || "—")}</td>
        <td>${
          state.sales.filter(
            s =>
              s.customerId === c.id &&
              s.status !== "cancelled"
          ).length
        }</td>
        <td>
          <button type="button" class="action-btn"
            data-client-action="edit"
            data-id="${esc(c.id)}">Editar</button>
          <button type="button" class="action-btn delete"
            data-client-action="delete"
            data-id="${esc(c.id)}">Eliminar</button>
        </td>
      </tr>
    `).join("") ||
    emptyRow(5, "Todavía no hay clientes para mostrar.");
}

// EDITAR Y ELIMINAR CLIENTES
function clientActions(event) {
  const btn = event.target.closest("[data-client-action]");
  if (!btn) return;

  const c = customerById(btn.dataset.id);
  if (!c) return;

  if (btn.dataset.clientAction === "edit") {
    $("#customerId").value = c.id;
    $("#customerName").value = c.name;
    $("#customerPhone").value = c.phone;
    $("#customerEmail").value = c.email;
    $("#customerNotes").value = c.notes;
    $("#customerFormTitle").textContent = "Editar cliente";
    $("#customerSubmitBtn").textContent = "Guardar cambios";
    $("#cancelCustomerEdit").classList.remove("hidden");
    $("#customerName").focus();
    return;
  }

  confirmAction(
    `¿Eliminar a “${c.name}” de la agenda? Sus ventas históricas se conservarán.`,
    () => {
      state.customers = state.customers.filter(
        x => x.id !== c.id
      );

      if (!save()) return;

      if ($("#customerId").value === c.id) {
        resetClient();
      }

      if ($("#saleClientSelect").value === c.id) {
        $("#saleClientSelect").value = "";
      }

      render();
      toast("Cliente eliminado de la agenda.");
    }
  );
}

// VISTA PREVIA DEL STOCK
function entryPreview() {
  const p = productById($("#entryProduct").value);

  $("#entryStockPreview").innerHTML = `
    <span>Stock actual</span>
    <strong>${p ? p.stock : 0} unidades</strong>
  `;
}

// INGRESAR MERCADERÍA
function addEntry(event) {
  event.preventDefault();

  const p = productById($("#entryProduct").value);
  const qty = Number($("#entryQuantity").value);
  const detail = $("#entryDetail").value.trim();

  if (!p) {
    toast("Seleccioná un producto.", true);
    return;
  }

  if (
    !Number.isSafeInteger(qty) ||
    qty <= 0 ||
    p.stock + qty > 1e9
  ) {
    toast("Ingresá una cantidad entera válida.", true);
    return;
  }

  p.stock += qty;

  state.movements.unshift(
    movement(
      p,
      "entry",
      qty,
      detail.slice(0, 160) || "Ingreso de mercadería"
    )
  );

  if (!save()) return;

  $("#entryQuantity").value = 1;
  $("#entryDetail").value = "";

  render();
  $("#entryProduct").value = p.id;
  entryPreview();

  toast(`Ingreso registrado. Stock actual: ${p.stock}.`);
}

// TABLA DE MOVIMIENTOS
function renderMovements() {
  const filter = $("#movementTypeFilter").value;

  const items = state.movements.filter(
    m => !filter || m.type === filter
  );

  $("#movementsTable").innerHTML =
    items.map(m => `
      <tr>
        <td>${dateTime(m.date)}</td>
        <td>${badgeMove(m.type)}</td>
        <td>${esc(m.productName)}</td>
        <td class="${m.delta < 0 ? "qty-negative" : "qty-positive"}">
          ${moveQty(m)}
        </td>
        <td>${m.resultStock}</td>
        <td>${esc(m.detail || "—")}</td>
      </tr>
    `).join("") ||
    emptyRow(6, "No hay movimientos para mostrar.");
}

// STOCK BAJO
function renderLow() {
  const items = state.products
    .filter(p => p.stock <= p.minStock)
    .sort((a, b) => a.stock - b.stock);

  $("#lowStockTable").innerHTML =
    items.map(p => `
      <tr>
        <td>${esc(p.name)}</td>
        <td>${esc(p.category)}</td>
        <td>${p.stock}</td>
        <td>${p.minStock}</td>
        <td>${Math.max(p.minStock - p.stock, 0)}</td>
        <td>${stockBadge(p)}</td>
      </tr>
    `).join("") ||
    emptyRow(6, "No hay productos para reponer.");
}

// AGRUPAR PRODUCTOS POR CATEGORÍA
function categorySummary() {
  const map = new Map();

  state.products.forEach(p => {
    const value = map.get(p.category) || {
      category: p.category,
      products: 0,
      units: 0
    };

    value.products++;
    value.units += p.stock;

    map.set(p.category, value);
  });

  return [...map.values()]
    .sort((a, b) => b.units - a.units);
}

// MOSTRAR CATEGORÍAS
function renderCategories() {
  $("#categoriesCards").innerHTML =
    categorySummary().map(c => `
      <article class="panel category-card">
        <div class="category-icon">🏷️</div>
        <h3>${esc(c.category)}</h3>
        <div class="category-metrics">
          <div>
            <strong>${c.products}</strong>
            <span>productos</span>
          </div>
          <div>
            <strong>${c.units}</strong>
            <span>unidades</span>
          </div>
        </div>
      </article>
    `).join("") ||
    '<div class="panel empty-cell">Todavía no hay categorías.</div>';
}

// REPORTES
function renderReports() {
  const active = state.sales.filter(
    s => s.status !== "cancelled"
  );

  const unitSum = state.products.reduce(
    (sum, p) => sum + p.stock,
    0
  );

  const sold = active.reduce(
    (sum, s) =>
      sum + s.items.reduce(
        (n, i) => n + i.quantity,
        0
      ),
    0
  );

  const entries = state.movements
    .filter(m => m.type === "entry")
    .reduce((sum, m) => sum + m.quantity, 0);

  const value = state.products.reduce(
    (sum, p) => sum + p.stock * p.price,
    0
  );

  $("#reportUnits").textContent = unitSum.toLocaleString("es-AR");
  $("#reportSoldUnits").textContent = sold.toLocaleString("es-AR");
  $("#reportEntryUnits").textContent = entries.toLocaleString("es-AR");
  $("#reportStockValue").textContent = money(value);
  $("#reportSalesCount").textContent = active.length;

  $("#reportRevenue").textContent = money(
    active.reduce((sum, s) => sum + s.total, 0)
  );

  const soldMap = new Map();

  active.forEach(s =>
    s.items.forEach(i => {
      const previous = soldMap.get(i.productId) || {
        name: i.name,
        qty: 0
      };

      previous.qty += i.quantity;
      soldMap.set(i.productId, previous);
    })
  );

  const top = [...soldMap.values()]
    .sort((a, b) => b.qty - a.qty)
    .slice(0, 6);

  const max = top[0]?.qty || 1;

  $("#topProductsList").innerHTML =
    top.map(i => `
      <div class="top-product-row">
        <span>${esc(i.name)}</span>
        <div class="progress">
          <i style="width:${Math.max(8, i.qty / max * 100)}%"></i>
        </div>
        <strong>${i.qty} u.</strong>
      </div>
    `).join("") ||
    '<div class="empty-cell">Todavía no hay ventas para analizar.</div>';
}

// HISTORIAL DE VENTAS
function renderSales() {
  const term = $("#salesSearch")
    .value.trim()
    .toLocaleLowerCase("es");

  const filter = $("#salesStatusFilter").value;

  const sales = state.sales.filter(s =>
    (!filter || s.status === filter) &&
    [
      s.number,
      s.customerName,
      s.customerPhone,
      ...s.items.map(i => i.name)
    ]
      .join(" ")
      .toLocaleLowerCase("es")
      .includes(term)
  );

  $("#salesHistoryTable").innerHTML =
    sales.map(s => `
      <tr>
        <td><strong>${esc(s.number)}</strong></td>
        <td>${dateTime(s.date)}</td>
        <td>${esc(s.customerName)}</td>
        <td>${
          s.items.reduce((n, i) => n + i.quantity, 0)
        } u. (${s.items.length} tipos)</td>
        <td>${money(s.total)}</td>
        <td>
          <span class="badge ${
            s.status === "cancelled" ? "cancelled" : "ok"
          }">
            ${s.status === "cancelled" ? "Anulada" : "Confirmada"}
          </span>
        </td>
        <td>
          <button type="button" class="action-btn"
            data-sale-action="print"
            data-id="${esc(s.id)}">Ticket</button>
          ${
            s.status === "cancelled"
              ? ""
              : `<button type="button" class="action-btn delete"
                   data-sale-action="cancel"
                   data-id="${esc(s.id)}">Anular</button>`
          }
        </td>
      </tr>
    `).join("") ||
    emptyRow(7, "Todavía no hay ventas para mostrar.");
}

// REIMPRIMIR O ANULAR VENTAS
function saleActions(event) {
  const btn = event.target.closest("[data-sale-action]");
  if (!btn) return;

  const s = state.sales.find(
    s => s.id === btn.dataset.id
  );

  if (!s) return;

  if (btn.dataset.saleAction === "print") {
    printTicket(s);
    return;
  }

  if (s.status === "cancelled") return;

  confirmAction(
    `¿Anular ${s.number}? Los productos que todavía existen se devolverán al stock y quedará registro del movimiento.`,
    () => {
      if (s.status === "cancelled") return;

      for (const i of s.items) {
        const p = productById(i.productId);

        if (p && p.stock + i.quantity > 1e9) {
          toast("Cantidad demasiado grande para reponer.", true);
          return;
        }
      }

      s.status = "cancelled";
      s.cancelledAt = new Date().toISOString();

      for (const i of s.items) {
        const p = productById(i.productId);
        if (!p) continue;

        p.stock += i.quantity;

        state.movements.unshift(
          movement(
            p,
            "return",
            i.quantity,
            `Anulación ${s.number}`
          )
        );
      }

      if (!save()) return;

      render();
      toast(
        "Venta anulada; stock devuelto a los productos existentes."
      );
    }
  );
}

// DESCARGAR ARCHIVOS
function download(content, filename, mime) {
  const url = URL.createObjectURL(
    new Blob([content], { type: mime })
  );

  const a = document.createElement("a");
  a.href = url;
  a.download = filename;

  document.body.appendChild(a);
  a.click();
  a.remove();

  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// CREAR CSV COMPATIBLE CON EXCEL
function csv(headers, rows) {
  const safe = x =>
    typeof x === "string" &&
    /^\s*[=+@\-\t\r]/.test(x)
      ? `'${x}`
      : x;

  const quote = x => {
    const text = String(safe(x) ?? "");

    return /[;"\r\n]/.test(text)
      ? `"${text.replaceAll('"', '""')}"`
      : text;
  };

  return "\uFEFF" +
    [headers, ...rows]
      .map(row => row.map(quote).join(";"))
      .join("\r\n");
}

// EXPORTAR PRODUCTOS
function productsCsv() {
  download(
    csv(
      [
        "Código",
        "Producto",
        "Categoría",
        "Stock",
        "Stock mínimo",
        "Precio venta"
      ],
      state.products.map(p => [
        p.code,
        p.name,
        p.category,
        p.stock,
        p.minStock,
        p.price
      ])
    ),
    `productos-accord-${dayKey(new Date())}.csv`,
    "text/csv;charset=utf-8"
  );
}

// EXPORTAR MOVIMIENTOS
function movementsCsv() {
  download(
    csv(
      [
        "Fecha",
        "Tipo",
        "Código",
        "Producto",
        "Cantidad",
        "Stock resultante",
        "Detalle"
      ],
      state.movements.map(m => [
        dateTime(m.date),
        m.type,
        m.productCode,
        m.productName,
        m.delta,
        m.resultStock,
        m.detail
      ])
    ),
    `movimientos-accord-${dayKey(new Date())}.csv`,
    "text/csv;charset=utf-8"
  );
}

// EXPORTAR VENTAS
function salesCsv() {
  download(
    csv(
      [
        "Número",
        "Fecha",
        "Cliente",
        "Teléfono",
        "Productos",
        "Unidades",
        "Total",
        "Estado"
      ],
      state.sales.map(s => [
        s.number,
        dateTime(s.date),
        s.customerName,
        s.customerPhone,
        s.items.map(i =>
          `${i.name} x${i.quantity}`
        ).join(" | "),
        s.items.reduce((n, i) => n + i.quantity, 0),
        s.total,
        s.status === "cancelled" ? "Anulada" : "Confirmada"
      ])
    ),
    `ventas-accord-${dayKey(new Date())}.csv`,
    "text/csv;charset=utf-8"
  );
}

// DESCARGAR RESPALDO COMPLETO
function exportBackup() {
  download(
    JSON.stringify(
      {
        app: "papelera-accord",
        version: 2,
        createdAt: new Date().toISOString(),
        data: state
      },
      null,
      2
    ),
    `respaldo-accord-${dayKey(new Date())}.json`,
    "application/json;charset=utf-8"
  );

  toast("Respaldo descargado. Guardalo en un lugar seguro.");
}

// LIMPIAR FORMULARIOS
function clearForms() {
  cart = [];
  selectedProductId = "";

  resetProduct();
  resetClient();

  $("#saleClientName").value = "";
  $("#saleClientPhone").value = "";

  clearSelectedProduct();

  $("#globalSearch").value = "";
  search = "";

  $("#customerSearch").value = "";
  $("#salesSearch").value = "";
  $("#productCategoryFilter").value = "";
  $("#productStatusFilter").value = "";
  $("#salesStatusFilter").value = "";
  $("#movementTypeFilter").value = "";
}

// RESTAURAR RESPALDO
async function importBackup() {
  const file = $("#importBackupFile").files?.[0];

  if (!file) {
    toast("Seleccioná un respaldo JSON.", true);
    return;
  }

  if (file.size > 10 * 1024 * 1024) {
    toast("El archivo supera 10 MB.", true);
    return;
  }

  let restored;

  try {
    const content = JSON.parse(await file.text());

    if (
      content.app !== "papelera-accord" ||
      content.version !== 2
    ) {
      throw Error("El archivo no corresponde a este sistema.");
    }

    restored = validateData(content.data);
  } catch (err) {
    toast(`Respaldo inválido: ${err.message}`, true);
    return;
  }

  confirmAction(
    `¿Reemplazar todos los datos actuales con este respaldo? Contiene ${restored.products.length} productos, ${restored.customers.length} clientes y ${restored.sales.length} ventas.`,
    () => {
      try {
        const serialized = JSON.stringify(restored);

        localStorage.setItem(STORAGE_KEY, serialized);

        state = restored;
        savedSnapshot = serialized;
        readonly = false;

        clearForms();
        render();
        renderCart();

        $("#importBackupFile").value = "";

        toast("Respaldo restaurado.");
      } catch (err) {
        console.error(err);
        toast(
          "No se pudo guardar el respaldo en este navegador.",
          true
        );
      }
    }
  );
}

// REINICIAR SISTEMA A CERO
function resetAll() {
  confirmAction(
    "Vas a borrar todos los productos, clientes, ventas y movimientos de este navegador. ¿Continuar?",
    () => {
      if (
        prompt(
          "Para confirmar el borrado irreversible, escribí BORRAR:"
        ) !== "BORRAR"
      ) {
        toast("Borrado cancelado.");
        return;
      }

      try {
        const next = emptyData();
        const serialized = JSON.stringify(next);

        localStorage.setItem(STORAGE_KEY, serialized);

        state = next;
        savedSnapshot = serialized;
        readonly = false;

        clearForms();
        render();
        renderCart();
        nav("dashboard");

        toast("Sistema vacío: podés empezar a cargar productos.");
      } catch (err) {
        toast(
          "No se pudo borrar la información del navegador.",
          true
        );
      }
    }
  );
}

// CONECTAR BOTONES, FORMULARIOS Y EVENTOS
function bind() {
  $$(".nav-item").forEach(b =>
    b.addEventListener("click", () => nav(b.dataset.section))
  );

  $$("[data-go]").forEach(b =>
    b.addEventListener("click", () => nav(b.dataset.go))
  );

  $("#globalSearch").addEventListener("input", e => {
    search = e.target.value.trim().toLocaleLowerCase("es");
    renderProducts();

    if (search) nav("products");
  });

  // PRODUCTOS
  $("#productForm").addEventListener("submit", saveProduct);
  $("#cancelEditBtn").addEventListener("click", resetProduct);
  $("#productsTable").addEventListener("click", productActions);
  $("#productCategoryFilter").addEventListener("change", renderProducts);
  $("#productStatusFilter").addEventListener("change", renderProducts);

  // CLIENTE EN LA VENTA
  $("#saleClientSelect").addEventListener("change", selectClient);

  $("#saveSaleCustomer").addEventListener(
    "click",
    saveClientFromSale
  );

  $("#saleClientName").addEventListener("input", () => {
    const c = customerById($("#saleClientSelect").value);

    if (
      c &&
      c.name !== $("#saleClientName").value.trim()
    ) {
      $("#saleClientSelect").value = "";
    }
  });

  // BUSCAR PRODUCTOS PARA VENDER
  $("#saleProductSearch").addEventListener(
    "input",
    findSaleProducts
  );

  $("#saleSearchResults").addEventListener("click", e => {
    const result = e.target.closest("[data-sale-product-id]");

    if (result) {
      selectSaleProduct(result.dataset.saleProductId);
    }
  });

  document.addEventListener("click", e => {
    if (!e.target.closest(".product-sale-search")) {
      $("#saleSearchResults").classList.add("hidden");
    }
  });

  // CARRITO Y VENTAS
  $("#addProductToSale").addEventListener("click", addToCart);
  $("#saleCartTable").addEventListener("click", cartAction);
  $("#saleCartTable").addEventListener("change", cartQuantity);
  $("#clearSaleCart").addEventListener("click", clearCart);
  $("#finishSaleButton").addEventListener("click", finishSale);

  // CLIENTES
  $("#customerForm").addEventListener("submit", saveClient);
  $("#cancelCustomerEdit").addEventListener("click", resetClient);
  $("#customerSearch").addEventListener("input", renderClients);
  $("#customersTable").addEventListener("click", clientActions);

  // INGRESO DE MERCADERÍA
  $("#entryProduct").addEventListener("change", entryPreview);
  $("#entryForm").addEventListener("submit", addEntry);

  // MOVIMIENTOS Y VENTAS
  $("#movementTypeFilter").addEventListener(
    "change",
    renderMovements
  );

  $("#salesSearch").addEventListener("input", renderSales);
  $("#salesStatusFilter").addEventListener("change", renderSales);
  $("#salesHistoryTable").addEventListener("click", saleActions);

  // EXPORTACIONES
  $("#downloadMovementsCsv").addEventListener(
    "click",
    movementsCsv
  );

  $("#downloadProductsCsv").addEventListener(
    "click",
    productsCsv
  );

  $("#downloadSalesCsv").addEventListener(
    "click",
    salesCsv
  );

  // RESPALDOS
  $("#exportBackup").addEventListener("click", exportBackup);
  $("#importBackup").addEventListener("click", importBackup);
  $("#resetAllData").addEventListener("click", resetAll);

  // CONFIRMACIONES
  $("#confirmActionBtn").addEventListener("click", () => {
    const action = modalAction;
    closeModal();
    action?.();
  });

  $$("[data-close-modal]").forEach(b =>
    b.addEventListener("click", closeModal)
  );

  document.addEventListener("keydown", e => {
    if (e.key === "Escape") {
      closeModal();
    }
  });
}

// INICIAR EL SISTEMA
bind();
render();
renderCart();