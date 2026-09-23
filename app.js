¿"use strict";

// =====================================================
// PAPELERA ACCORD
// SISTEMA DE STOCK + SUPABASE
// =====================================================

// Este archivo NO guarda el inventario en localStorage.
// Los datos principales se reciben y guardan mediante cloud.js.

// =====================================================
// UTILIDADES
// =====================================================

const $ = selector => document.querySelector(selector);

const $$ = selector => [
  ...document.querySelectorAll(selector)
];

const emptyData = () => ({
  products: [],
  customers: [],
  movements: [],
  sales: []
});

const uuid = () => {
  if (
    typeof crypto !== "undefined" &&
    typeof crypto.randomUUID === "function"
  ) {
    return crypto.randomUUID();
  }

  return (
    "id-" +
    Date.now() +
    "-" +
    Math.random().toString(36).slice(2)
  );
};


// =====================================================
// ESCAPAR TEXTO HTML
// =====================================================

const esc = value =>
  String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");


// =====================================================
// FORMATO DE DINERO
// =====================================================

const money = value =>
  new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency: "ARS",
    maximumFractionDigits: 2
  }).format(Number(value) || 0);


// =====================================================
// FORMATO DE FECHA Y HORA
// =====================================================

const dateTime = value => {
  try {
    return new Intl.DateTimeFormat("es-AR", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit"
    }).format(new Date(value));
  } catch {
    return "";
  }
};


// =====================================================
// CLAVE DE FECHA
// =====================================================

const dayKey = value => {
  const d = new Date(value);

  return (
    `${d.getFullYear()}-` +
    `${String(d.getMonth() + 1).padStart(2, "0")}-` +
    `${String(d.getDate()).padStart(2, "0")}`
  );
};


// =====================================================
// ESTADO DEL SISTEMA
// =====================================================

let state = emptyData();

let savedSnapshot = JSON.stringify(state);

let appStarted = false;

let savingCloud = false;

let search = "";

let cart = [];

let selectedProductId = "";

let modalAction = null;

let toastTimer;


// =====================================================
// BUSCAR PRODUCTO Y CLIENTE POR ID
// =====================================================

const productById = id =>
  state.products.find(
    product => product.id === id
  );

const customerById = id =>
  state.customers.find(
    customer => customer.id === id
  );


// =====================================================
// ESTADO DEL STOCK
// =====================================================

const stockStatus = product => {

  if (product.stock === 0) {
    return "out";
  }

  if (product.stock <= product.minStock) {
    return "low";
  }

  return "ok";
};


const stockBadge = product => {

  const status = stockStatus(product);

  const labels = {
    out: "Sin stock",
    low: "Stock bajo",
    ok: "Disponible"
  };

  return `
    <span class="badge ${status}">
      ${labels[status]}
    </span>
  `;
};


const emptyRow = (columns, message) => `
  <tr>
    <td
      class="empty-cell"
      colspan="${columns}"
    >
      ${esc(message)}
    </td>
  </tr>
`;


// =====================================================
// VALIDAR DATOS RECIBIDOS
// =====================================================

function validateData(data) {

  if (
    !data ||
    typeof data !== "object" ||
    !Array.isArray(data.products) ||
    !Array.isArray(data.customers) ||
    !Array.isArray(data.movements) ||
    !Array.isArray(data.sales)
  ) {
    throw new Error(
      "El inventario recibido no tiene un formato válido."
    );
  }


  const text = (
    value,
    maxLength = 180
  ) =>
    String(value ?? "")
      .slice(0, maxLength);


  const naturalNumber = (
    value,
    label
  ) => {

    const number = Number(value);

    if (
      !Number.isSafeInteger(number) ||
      number < 0 ||
      number > 1000000000
    ) {
      throw new Error(
        `Cantidad inválida: ${label}`
      );
    }

    return number;
  };


  const amount = (
    value,
    label
  ) => {

    const number = Number(value);

    if (
      !Number.isFinite(number) ||
      number < 0 ||
      number > 1000000000000
    ) {
      throw new Error(
        `Precio inválido: ${label}`
      );
    }

    return number;
  };


  const validDate = value => {

    if (
      typeof value !== "string" ||
      !Number.isFinite(Date.parse(value))
    ) {
      throw new Error(
        "Fecha inválida."
      );
    }

    return value;
  };


  const ids = new Set();

  const codes = new Set();

  const saleNumbers = new Set();


  const validateId = (
    value,
    type
  ) => {

    const id = text(value, 120);

    if (!id) {
      throw new Error(
        `Falta identificador de ${type}.`
      );
    }

    const uniqueKey =
      `${type}:${id}`;

    if (ids.has(uniqueKey)) {
      throw new Error(
        `Identificador duplicado: ${type}.`
      );
    }

    ids.add(uniqueKey);

    return id;
  };


  // ===================================================
  // PRODUCTOS
  // ===================================================

  const products = data.products.map(
    product => {

      if (
        !product ||
        typeof product !== "object"
      ) {
        throw new Error(
          "Producto inválido."
        );
      }


      const code =
        text(product.code, 80).trim();

      const name =
        text(product.name, 160).trim();

      const category =
        text(product.category, 100).trim();


      if (
        !code ||
        !name ||
        !category
      ) {
        throw new Error(
          "Hay un producto incompleto."
        );
      }


      const normalizedCode =
        code.toLocaleLowerCase("es");


      if (
        codes.has(normalizedCode)
      ) {
        throw new Error(
          `Código de producto repetido: ${code}`
        );
      }


      codes.add(normalizedCode);


      return {

        id: validateId(
          product.id,
          "producto"
        ),

        code,

        name,

        category,

        stock: naturalNumber(
          product.stock,
          "stock"
        ),

        minStock: naturalNumber(
          product.minStock,
          "stock mínimo"
        ),

        price: amount(
          product.price ?? 0,
          "producto"
        )

      };

    }
  );


  // ===================================================
  // CLIENTES
  // ===================================================

  const customers = data.customers.map(
    customer => {

      if (
        !customer ||
        typeof customer !== "object"
      ) {
        throw new Error(
          "Cliente inválido."
        );
      }


      const name =
        text(
          customer.name,
          120
        ).trim();


      if (!name) {
        throw new Error(
          "Hay un cliente sin nombre."
        );
      }


      return {

        id: validateId(
          customer.id,
          "cliente"
        ),

        name,

        phone: text(
          customer.phone,
          40
        ),

        email: text(
          customer.email,
          160
        ),

        notes: text(
          customer.notes,
          400
        )

      };

    }
  );


  // ===================================================
  // VENTAS
  // ===================================================

  const sales = data.sales.map(
    sale => {

      if (
        !sale ||
        typeof sale !== "object" ||
        !Array.isArray(sale.items) ||
        !sale.items.length
      ) {
        throw new Error(
          "Venta incompleta."
        );
      }


      const number =
        text(
          sale.number,
          80
        ).trim();


      if (!number) {
        throw new Error(
          "Hay una venta sin número."
        );
      }


      if (
        saleNumbers.has(number)
      ) {
        throw new Error(
          `Número de venta repetido: ${number}`
        );
      }


      saleNumbers.add(number);


      const items =
        sale.items.map(item => {

          if (
            !item ||
            typeof item !== "object"
          ) {
            throw new Error(
              "Artículo de venta inválido."
            );
          }


          const quantity =
            naturalNumber(
              item.quantity,
              "venta"
            );


          if (quantity === 0) {
            throw new Error(
              "Cantidad de venta inválida."
            );
          }


          return {

            productId: text(
              item.productId,
              120
            ),

            code: text(
              item.code,
              80
            ),

            name: text(
              item.name,
              160
            ),

            quantity,

            price: amount(
              item.price ?? 0,
              "venta"
            )

          };

        });


      const total =
        amount(
          sale.total ?? 0,
          "total de venta"
        );


      const calculatedTotal =
        items.reduce(
          (
            sum,
            item
          ) =>
            sum +
            item.price *
            item.quantity,
          0
        );


      if (
        Math.abs(
          calculatedTotal -
          total
        ) > 0.011
      ) {
        throw new Error(
          `Total inconsistente en ${number}.`
        );
      }


      return {

        id: validateId(
          sale.id,
          "venta"
        ),

        number,

        date: validDate(
          sale.date
        ),

        customerId: text(
          sale.customerId,
          120
        ),

        customerName: text(
          sale.customerName,
          120
        ),

        customerPhone: text(
          sale.customerPhone,
          40
        ),

        status:
          sale.status === "cancelled"
            ? "cancelled"
            : "active",

        cancelledAt:
          sale.cancelledAt
            ? validDate(
                sale.cancelledAt
              )
            : "",

        items,

        total

      };

    }
  );


  // ===================================================
  // MOVIMIENTOS
  // ===================================================

  const movements =
    data.movements.map(
      movement => {

        if (
          !movement ||
          typeof movement !== "object" ||
          ![
            "sale",
            "entry",
            "adjustment",
            "return"
          ].includes(
            movement.type
          )
        ) {
          throw new Error(
            "Movimiento inválido."
          );
        }


        const quantity =
          naturalNumber(
            movement.quantity,
            "movimiento"
          );


        if (quantity === 0) {
          throw new Error(
            "Movimiento sin cantidad."
          );
        }


        const delta =
          movement.delta ??
          (
            movement.type === "sale"
              ? -quantity
              : quantity
          );


        if (
          !Number.isSafeInteger(delta) ||
          Math.abs(delta) >
            1000000000
        ) {
          throw new Error(
            "Ajuste de stock inválido."
          );
        }


        return {

          id: validateId(
            movement.id,
            "movimiento"
          ),

          date: validDate(
            movement.date
          ),

          type:
            movement.type,

          productId: text(
            movement.productId,
            120
          ),

          productCode: text(
            movement.productCode,
            80
          ),

          productName: text(
            movement.productName,
            160
          ),

          quantity,

          resultStock:
            naturalNumber(
              movement.resultStock,
              "stock resultante"
            ),

          detail: text(
            movement.detail,
            240
          ),

          delta

        };

      }
    );


  return {

    products,

    customers,

    movements,

    sales

  };

}


// =====================================================
// NOTIFICACIONES
// =====================================================

function toast(
  message,
  error = false
) {

  const node =
    $("#toast");

  if (!node) {
    return;
  }


  node.textContent =
    message;


  node.classList.toggle(
    "error",
    error
  );


  node.classList.add(
    "show"
  );


  clearTimeout(
    toastTimer
  );


  toastTimer =
    setTimeout(
      () => {
        node.classList.remove(
          "show"
        );
      },
      3600
    );

}


// Funciones usadas también desde cloud.js

window.showCloudError =
  message => {

    toast(
      message,
      true
    );

  };


window.showCloudSuccess =
  message => {

    toast(
      message,
      false
    );

  };


// =====================================================
// ESTADO "GUARDANDO"
// =====================================================

function setCloudBusy(
  busy
) {

  savingCloud = busy;

  document.body.classList.toggle(
    "cloud-busy",
    busy
  );

}


// =====================================================
// GUARDAR EN SUPABASE
// =====================================================

async function save() {

  if (savingCloud) {
    return false;
  }


  const previousSnapshot =
    savedSnapshot;


  const nextSnapshot =
    JSON.stringify(state);


  if (
    nextSnapshot ===
    previousSnapshot
  ) {
    return true;
  }


  if (
    !window.cloud ||
    typeof window.cloud.commit !==
      "function"
  ) {

    console.error(
      "cloud.js todavía no está disponible."
    );

    toast(
      "No se pudo conectar con el almacenamiento online.",
      true
    );

    return false;

  }


  setCloudBusy(true);


  try {

    const ok =
      await window.cloud.commit(
        state
      );


 if (!ok) {

  const latest =
    await window.cloud.load();

  state =
    validateData(
      latest
    );

  savedSnapshot =
    JSON.stringify(
      state
    );

  render();

  renderCart();

  toast(
    "Había cambios desde otro dispositivo. Cargamos la versión más reciente. Repetí la acción.",
    true
  );

  return false;

}


    savedSnapshot =
      nextSnapshot;


    return true;

  } catch (error) {

    console.error(
      "Error al guardar:",
      error
    );


    state =
      JSON.parse(
        previousSnapshot
      );


    render();

    renderCart();


    toast(
      "No se pudieron guardar los cambios en la nube. Revisá tu conexión.",
      true
    );


    return false;

  } finally {

    setCloudBusy(false);

  }

}// =====================================================
// CONFIRMACIONES
// =====================================================

function confirmAction(
  message,
  action
) {

  modalAction = action;

  $("#confirmMessage").textContent =
    message;

  $("#confirmModal")
    .classList.remove("hidden");

  $("#confirmModal")
    .setAttribute(
      "aria-hidden",
      "false"
    );

}


function closeModal() {

  modalAction = null;

  $("#confirmModal")
    .classList.add("hidden");

  $("#confirmModal")
    .setAttribute(
      "aria-hidden",
      "true"
    );

}


// =====================================================
// NAVEGACIÓN
// =====================================================

function nav(section) {

  const target =
    document.getElementById(
      section
    );


  if (
    !target ||
    !target.classList.contains(
      "page-section"
    )
  ) {
    return;
  }


  $$(".page-section")
    .forEach(page => {

      page.classList.toggle(
        "active",
        page.id === section
      );

    });


  $$(".nav-item")
    .forEach(button => {

      button.classList.toggle(
        "active",
        button.dataset.section ===
          section
      );

    });


  window.scrollTo({
    top: 0,
    behavior: "instant"
  });

}


// =====================================================
// CREAR MOVIMIENTO
// =====================================================

function movement(
  product,
  type,
  quantity,
  detail,
  delta =
    type === "sale"
      ? -quantity
      : quantity
) {

  return {

    id: uuid(),

    date:
      new Date()
        .toISOString(),

    type,

    productId:
      product.id,

    productCode:
      product.code,

    productName:
      product.name,

    quantity,

    resultStock:
      product.stock,

    detail,

    delta

  };

}


// =====================================================
// ETIQUETA DE MOVIMIENTOS
// =====================================================

function badgeMove(type) {

  const labels = {

    sale:
      "Venta",

    entry:
      "Entrada",

    adjustment:
      "Ajuste",

    return:
      "Devolución"

  };


  return `
    <span class="badge ${esc(type)}">
      ${labels[type] || esc(type)}
    </span>
  `;

}


function moveQty(movement) {

  return (
    `${movement.delta > 0 ? "+" : ""}` +
    `${movement.delta}`
  );

}


// =====================================================
// ACTUALIZAR TODAS LAS PANTALLAS
// =====================================================

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


  $("#firstSteps")
    ?.classList.toggle(
      "hidden",
      state.products.length !== 0
    );

}


// =====================================================
// DASHBOARD
// =====================================================

function renderDashboard() {

  const low =
    state.products.filter(
      product =>
        product.stock <=
        product.minStock
    );


  const today =
    dayKey(
      new Date()
    );


  $("#statProducts").textContent =
    state.products.length;


  $("#statLow").textContent =
    low.length;


  $("#statSalesToday").textContent =
    state.sales.filter(
      sale =>
        sale.status !== "cancelled" &&
        dayKey(sale.date) === today
    ).length;


  $("#statMovementsToday")
    .textContent =
      state.movements.filter(
        movement =>
          dayKey(
            movement.date
          ) === today
      ).length;


  // ===============================================
  // PRODUCTOS CON STOCK BAJO
  // ===============================================

  $("#dashboardLowStock")
    .innerHTML =

      low
        .sort(
          (a, b) =>
            a.stock - b.stock
        )
        .slice(
          0,
          5
        )
        .map(
          product => `
            <tr>

              <td>
                ${esc(product.name)}
              </td>

              <td>
                ${product.stock}
              </td>

              <td>
                ${product.minStock}
              </td>

              <td>
                ${stockBadge(product)}
              </td>

            </tr>
          `
        )
        .join("") ||

      emptyRow(
        4,
        "No hay productos pendientes de reposición."
      );


  // ===============================================
  // ÚLTIMOS MOVIMIENTOS
  // ===============================================

  $("#dashboardMovements")
    .innerHTML =

      state.movements
        .slice(
          0,
          6
        )
        .map(
          item => `
            <tr>

              <td>
                ${dateTime(item.date)}
              </td>

              <td>
                ${badgeMove(item.type)}
              </td>

              <td>
                ${esc(item.productName)}
              </td>

              <td
                class="${
                  item.delta < 0
                    ? "qty-negative"
                    : "qty-positive"
                }"
              >
                ${moveQty(item)}
              </td>

              <td>
                ${item.resultStock}
              </td>

            </tr>
          `
        )
        .join("") ||

      emptyRow(
        5,
        "Todavía no hay movimientos."
      );


  // ===============================================
  // GRÁFICO DE CATEGORÍAS
  // ===============================================

  const summary =
    categorySummary();


  const total =
    summary.reduce(
      (
        sum,
        category
      ) =>
        sum +
        category.units,
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


  $("#donutTotal").textContent =
    total.toLocaleString(
      "es-AR"
    );


  let position = 0;


  if (total > 0) {

    const segments =
      summary.map(
        (
          category,
          index
        ) => {

          const start =
            position;


          position +=
            category.units /
            total *
            100;


          return (
            `${colors[
              index %
              colors.length
            ]} ` +
            `${start}% ` +
            `${position}%`
          );

        }
      );


    $("#categoryDonut")
      .style.background =
        `conic-gradient(${segments.join(",")})`;

  } else {

    $("#categoryDonut")
      .style.background =
        "#e8eef3";

  }


  $("#categoryLegend")
    .innerHTML =

      total > 0

        ? summary
            .slice(
              0,
              8
            )
            .map(
              (
                category,
                index
              ) => `

                <div class="legend-row">

                  <span
                    class="legend-dot"
                    style="
                      background:
                      ${
                        colors[
                          index %
                          colors.length
                        ]
                      }
                    "
                  ></span>

                  <span>
                    ${esc(
                      category.category
                    )}
                  </span>

                  <strong>
                    ${
                      Math.round(
                        category.units /
                        total *
                        100
                      )
                    }%
                  </strong>

                </div>

              `
            )
            .join("")

        : `
            <div class="empty-cell">
              Sin datos de categorías
            </div>
          `;

}


// =====================================================
// OPCIONES DE PRODUCTOS
// =====================================================

function renderProductOptions() {

  const categories = [

    ...new Set(
      state.products.map(
        product =>
          product.category
      )
    )

  ].sort(
    (
      a,
      b
    ) =>
      a.localeCompare(
        b,
        "es"
      )
  );


  // DATALIST DE CATEGORÍAS

  $("#categoryOptions")
    .innerHTML =

      categories
        .map(
          category => `
            <option
              value="${esc(category)}"
            ></option>
          `
        )
        .join("");


  // FILTRO DE PRODUCTOS

  const filter =
    $("#productCategoryFilter");


  const previousFilter =
    filter.value;


  filter.innerHTML =

    `
      <option value="">
        Todas las categorías
      </option>
    ` +

    categories
      .map(
        category => `
          <option
            value="${esc(category)}"
          >
            ${esc(category)}
          </option>
        `
      )
      .join("");


  if (
    categories.includes(
      previousFilter
    )
  ) {

    filter.value =
      previousFilter;

  }


  // SELECT PARA INGRESAR MERCADERÍA

  const select =
    $("#entryProduct");


  const previousProduct =
    select.value;


  select.innerHTML =

    `
      <option value="">
        Seleccionar producto...
      </option>
    ` +

    [...state.products]
      .sort(
        (
          a,
          b
        ) =>
          a.name.localeCompare(
            b.name,
            "es"
          )
      )
      .map(
        product => `
          <option
            value="${esc(product.id)}"
          >
            ${esc(product.name)}
            —
            Stock: ${product.stock}
          </option>
        `
      )
      .join("");


  if (
    productById(
      previousProduct
    )
  ) {

    select.value =
      previousProduct;

  }

}


// =====================================================
// LISTADO DE PRODUCTOS
// =====================================================

function renderProducts() {

  const category =
    $("#productCategoryFilter")
      .value;


  const status =
    $("#productStatusFilter")
      .value;


  const products =

    [...state.products]

      .filter(
        product => {

          const matchesCategory =
            !category ||
            product.category ===
              category;


          const matchesStatus =
            !status ||
            stockStatus(
              product
            ) === status;


          const matchesSearch =

            [
              product.code,
              product.name,
              product.category
            ]

              .join(" ")

              .toLocaleLowerCase(
                "es"
              )

              .includes(
                search
              );


          return (
            matchesCategory &&
            matchesStatus &&
            matchesSearch
          );

        }
      )

      .sort(
        (
          a,
          b
        ) =>
          a.name.localeCompare(
            b.name,
            "es"
          )
      );


  $("#productCountText")
    .textContent =

      `${products.length} ` +

      (
        products.length === 1
          ? "producto"
          : "productos"
      );


  $("#productsTable")
    .innerHTML =

      products
        .map(
          product => `

            <tr>

              <td>
                <strong>
                  ${esc(product.code)}
                </strong>
              </td>

              <td>
                ${esc(product.name)}
              </td>

              <td>
                ${esc(product.category)}
              </td>

              <td>
                ${product.stock}
              </td>

              <td>
                ${product.minStock}
              </td>

              <td>
                ${stockBadge(product)}
              </td>

              <td>

                <button
                  class="action-btn"
                  type="button"
                  data-product-action="edit"
                  data-id="${esc(product.id)}"
                >
                  Editar
                </button>

                <button
                  class="action-btn delete"
                  type="button"
                  data-product-action="delete"
                  data-id="${esc(product.id)}"
                >
                  Eliminar
                </button>

              </td>

            </tr>

          `
        )
        .join("") ||

      emptyRow(
        7,
        "No hay productos para mostrar."
      );

}


// =====================================================
// LIMPIAR FORMULARIO DE PRODUCTOS
// =====================================================

function resetProduct() {

  $("#productForm")
    .reset();


  $("#productId")
    .value = "";


  $("#productStock")
    .value = 0;


  $("#productMinStock")
    .value = 10;


  $("#productFormTitle")
    .textContent =
      "Nuevo producto";


  $("#productSubmitBtn")
    .textContent =
      "Guardar producto";


  $("#cancelEditBtn")
    .classList.add(
      "hidden"
    );

}


// =====================================================
// GUARDAR O EDITAR PRODUCTO
// =====================================================

async function saveProduct(
  event
) {

  event.preventDefault();


  if (savingCloud) {
    return;
  }


  const id =
    $("#productId")
      .value;


  const code =
    $("#productCode")
      .value
      .trim();


  const name =
    $("#productName")
      .value
      .trim();


  const category =
    $("#productCategory")
      .value
      .trim();


  const stock =
    Number(
      $("#productStock")
        .value
    );


  const minStock =
    Number(
      $("#productMinStock")
        .value
    );


  const price =
    Number(
      $("#productPrice")
        .value ||
      0
    );


  // ===============================================
  // VALIDAR CAMPOS
  // ===============================================

  if (
    !code ||
    !name ||
    !category ||
    code.length > 80 ||
    name.length > 160 ||
    category.length > 100
  ) {

    toast(
      "Completá código, nombre y categoría correctamente.",
      true
    );

    return;

  }


  if (
    !Number.isSafeInteger(
      stock
    ) ||
    !Number.isSafeInteger(
      minStock
    ) ||
    stock < 0 ||
    minStock < 0 ||
    stock > 1000000000 ||
    minStock > 1000000000 ||
    !Number.isFinite(
      price
    ) ||
    price < 0 ||
    price > 1000000000000
  ) {

    toast(
      "Revisá stock, mínimo y precio.",
      true
    );

    return;

  }


  // ===============================================
  // EVITAR CÓDIGOS REPETIDOS
  // ===============================================

  const duplicatedCode =
    state.products.some(
      product =>

        product.id !== id &&

        product.code
          .toLocaleLowerCase(
            "es"
          ) ===

        code
          .toLocaleLowerCase(
            "es"
          )
    );


  if (
    duplicatedCode
  ) {

    toast(
      "Ya existe un producto con ese código.",
      true
    );

    return;

  }


  // ===============================================
  // EDITAR PRODUCTO
  // ===============================================

  if (id) {

    const product =
      productById(
        id
      );


    if (!product) {

      toast(
        "No encontramos el producto.",
        true
      );

      return;

    }


    const previousStock =
      product.stock;


    Object.assign(
      product,
      {

        code,

        name,

        category,

        stock,

        minStock,

        price

      }
    );


    // SI CAMBIÓ EL STOCK MANUALMENTE,
    // GUARDAMOS UN MOVIMIENTO.

    if (
      previousStock !==
      stock
    ) {

      state.movements.unshift(

        movement(

          product,

          "adjustment",

          Math.abs(
            stock -
            previousStock
          ),

          `Ajuste manual: ${previousStock} → ${stock}`,

          stock -
          previousStock

        )

      );

    }

  }


  // ===============================================
  // NUEVO PRODUCTO
  // ===============================================

  else {

    const product = {

      id:
        uuid(),

      code,

      name,

      category,

      stock,

      minStock,

      price

    };


    state.products.push(
      product
    );


    if (
      stock > 0
    ) {

      state.movements.unshift(

        movement(
          product,
          "entry",
          stock,
          "Stock inicial"
        )

      );

    }

  }


  // ===============================================
  // GUARDAR EN SUPABASE
  // ===============================================

  const saved =
    await save();


  if (!saved) {
    return;
  }


  resetProduct();

  render();


  toast(
    id
      ? "Producto actualizado."
      : "Producto guardado."
  );

}


// =====================================================
// EDITAR / ELIMINAR PRODUCTO
// =====================================================

function productActions(
  event
) {

  const button =
    event.target.closest(
      "[data-product-action]"
    );


  if (!button) {
    return;
  }


  const product =
    productById(
      button.dataset.id
    );


  if (!product) {
    return;
  }


  // ===============================================
  // EDITAR
  // ===============================================

  if (
    button.dataset
      .productAction ===
    "edit"
  ) {

    $("#productId")
      .value =
        product.id;


    $("#productCode")
      .value =
        product.code;


    $("#productName")
      .value =
        product.name;


    $("#productCategory")
      .value =
        product.category;


    $("#productStock")
      .value =
        product.stock;


    $("#productMinStock")
      .value =
        product.minStock;


    $("#productPrice")
      .value =
        product.price;


    $("#productFormTitle")
      .textContent =
        "Editar producto";


    $("#productSubmitBtn")
      .textContent =
        "Guardar cambios";


    $("#cancelEditBtn")
      .classList.remove(
        "hidden"
      );


    $("#productCode")
      .focus();


    return;

  }


  // ===============================================
  // ELIMINAR
  // ===============================================

  confirmAction(

    `¿Eliminar “${product.name}”? Se conservará el historial de ventas y movimientos.`,

    async () => {

      if (savingCloud) {
        return;
      }


      state.products =
        state.products.filter(
          item =>
            item.id !==
            product.id
        );


      const saved =
        await save();


      if (!saved) {
        return;
      }


      cart =
        cart.filter(
          item =>
            item.productId !==
            product.id
        );


      if (
        selectedProductId ===
        product.id
      ) {

        clearSelectedProduct();

      }


      if (
        $("#productId")
          .value ===
        product.id
      ) {

        resetProduct();

      }


      render();

      renderCart();


      toast(
        "Producto eliminado."
      );

    }

  );

}


// =====================================================
// BUSCAR PRODUCTOS DURANTE UNA VENTA
// =====================================================

function findSaleProducts() {

  const term =

    $("#saleProductSearch")

      .value

      .trim()

      .toLocaleLowerCase(
        "es"
      );


  selectedProductId =
    "";


  $("#selectedSaleProduct")
    .classList.add(
      "hidden"
    );


  $("#addProductToSale")
    .disabled =
      true;


  const results =
    $("#saleSearchResults");


  if (!term) {

    results
      .classList.add(
        "hidden"
      );


    results.innerHTML =
      "";


    return;

  }


  const matches =

    state.products

      .filter(
        product =>

          [
            product.name,
            product.code,
            product.category
          ]

            .join(" ")

            .toLocaleLowerCase(
              "es"
            )

            .includes(
              term
            )
      )

      .slice(
        0,
        15
      );


  results.innerHTML =

    matches
      .map(
        product => `

          <button
            type="button"
            class="sale-search-result"
            data-sale-product-id="${esc(product.id)}"
          >

            <div>

              <strong>
                ${esc(product.name)}
              </strong>

              <small>
                ${esc(product.code)}
                ·
                ${esc(product.category)}
              </small>

            </div>


            <div
              class="
                search-product-stock
                ${
                  product.stock === 0
                    ? "out"
                    : ""
                }
              "
            >

              <strong>
                ${money(product.price)}
              </strong>

              <small>
                Stock: ${product.stock}
              </small>

            </div>

          </button>

        `
      )
      .join("") ||

    `
      <div class="empty-cell">
        No encontramos productos.
      </div>
    `;


  results
    .classList.remove(
      "hidden"
    );

}


// =====================================================
// SELECCIONAR PRODUCTO PARA VENDER
// =====================================================

function selectSaleProduct(
  id
) {

  const product =
    productById(
      id
    );


  if (!product) {
    return;
  }


  selectedProductId =
    id;


  $("#saleProductSearch")
    .value =
      product.name;


  $("#saleSearchResults")
    .classList.add(
      "hidden"
    );


  $("#selectedSaleProduct")
    .classList.remove(
      "hidden"
    );


  $("#selectedSaleProductName")
    .textContent =
      product.name;


  $("#selectedSaleProductInfo")
    .textContent =

      `Código: ${product.code}` +
      ` · Stock disponible: ${product.stock}`;


  $("#selectedSaleProductPrice")
    .textContent =
      money(
        product.price
      );


  $("#saleProductQuantity")
    .value =
      1;


  $("#addProductToSale")
    .disabled =
      product.stock < 1;

}


// =====================================================
// LIMPIAR PRODUCTO SELECCIONADO
// =====================================================

function clearSelectedProduct() {

  selectedProductId =
    "";


  $("#saleProductSearch")
    .value =
      "";


  $("#selectedSaleProduct")
    .classList.add(
      "hidden"
    );


  $("#saleSearchResults")
    .classList.add(
      "hidden"
    );


  $("#addProductToSale")
    .disabled =
      true;


  $("#saleProductQuantity")
    .value =
      1;

}


// =====================================================
// AGREGAR PRODUCTO AL CARRITO
// =====================================================

function addToCart() {

  const product =
    productById(
      selectedProductId
    );


  const quantity =
    Number(
      $("#saleProductQuantity")
        .value
    );


  if (!product) {

    toast(
      "Seleccioná un producto.",
      true
    );

    return;

  }


  if (
    !Number.isSafeInteger(
      quantity
    ) ||
    quantity <= 0
  ) {

    toast(
      "Ingresá una cantidad entera mayor que cero.",
      true
    );

    return;

  }


  const current =
    cart.find(
      item =>
        item.productId ===
        product.id
    );


  const currentQuantity =
    current?.quantity ||
    0;


  if (
    quantity +
      currentQuantity >
    product.stock
  ) {

    toast(
      `Stock insuficiente. Disponible: ${product.stock}.`,
      true
    );

    return;

  }


  if (current) {

    current.quantity +=
      quantity;

  } else {

    cart.push({

      productId:
        product.id,

      code:
        product.code,

      name:
        product.name,

      price:
        product.price,

      quantity

    });

  }


  clearSelectedProduct();

  renderCart();


  $("#saleProductSearch")
    .focus();


  toast(
    "Producto agregado a la venta."
  );

}// =====================================================
// MOSTRAR CARRITO
// =====================================================

function renderCart() {

  const hasProducts =
    cart.length > 0;


  $("#emptySaleCart")
    .classList.toggle(
      "hidden",
      hasProducts
    );


  $("#saleCartTableWrapper")
    .classList.toggle(
      "hidden",
      !hasProducts
    );


  $("#finishSaleButton")
    .disabled =
      !hasProducts ||
      savingCloud;


  const totalUnits =
    cart.reduce(
      (
        total,
        item
      ) =>
        total +
        item.quantity,
      0
    );


  $("#saleItemsCount")
    .textContent =

      `${totalUnits} ` +

      (
        totalUnits === 1
          ? "producto"
          : "productos"
      );


  $("#saleCartTable")
    .innerHTML =

      cart
        .map(
          item => `

            <tr>

              <td class="cart-product-name">

                <strong>
                  ${esc(item.name)}
                </strong>

                <small>
                  ${esc(item.code)}
                </small>

              </td>


              <td>

                <input
                  class="cart-quantity-input"
                  type="number"
                  min="1"
                  step="1"
                  value="${item.quantity}"
                  data-cart-qty="${esc(item.productId)}"
                  aria-label="Cantidad de ${esc(item.name)}"
                >

              </td>


              <td>
                ${money(item.price)}
              </td>


              <td>

                <strong>
                  ${
                    money(
                      item.price *
                      item.quantity
                    )
                  }
                </strong>

              </td>


              <td>

                <button
                  type="button"
                  class="remove-cart-item"
                  data-cart-remove="${esc(item.productId)}"
                  title="Quitar"
                >
                  ×
                </button>

              </td>

            </tr>

          `
        )
        .join("");


  const total =
    cart.reduce(
      (
        sum,
        item
      ) =>
        sum +
        item.quantity *
        item.price,
      0
    );


  $("#saleSubtotal")
    .textContent =
      money(total);


  $("#saleTotal")
    .textContent =
      money(total);

}


// =====================================================
// QUITAR PRODUCTO DEL CARRITO
// =====================================================

function cartAction(
  event
) {

  const button =
    event.target.closest(
      "[data-cart-remove]"
    );


  if (!button) {
    return;
  }


  cart =
    cart.filter(
      item =>
        item.productId !==
        button.dataset.cartRemove
    );


  renderCart();

}


// =====================================================
// CAMBIAR CANTIDAD EN EL CARRITO
// =====================================================

function cartQuantity(
  event
) {

  const input =
    event.target.closest(
      "[data-cart-qty]"
    );


  if (!input) {
    return;
  }


  const item =
    cart.find(
      item =>
        item.productId ===
        input.dataset.cartQty
    );


  const product =
    productById(
      input.dataset.cartQty
    );


  const quantity =
    Number(
      input.value
    );


  if (
    !item ||
    !product
  ) {
    return;
  }


  if (
    !Number.isSafeInteger(
      quantity
    ) ||
    quantity < 1 ||
    quantity > product.stock
  ) {

    toast(
      `Cantidad inválida. Disponible: ${product.stock}.`,
      true
    );


    input.value =
      item.quantity;


    return;

  }


  item.quantity =
    quantity;


  renderCart();

}


// =====================================================
// VACIAR CARRITO
// =====================================================

function clearCart() {

  if (
    !cart.length
  ) {
    return;
  }


  confirmAction(

    "¿Vaciar todos los productos de esta venta?",

    () => {

      cart = [];

      clearSelectedProduct();

      renderCart();


      toast(
        "Carrito vaciado."
      );

    }

  );

}


// =====================================================
// GENERAR NÚMERO DE VENTA
// =====================================================

function saleNumber() {

  const maximum =
    state.sales.reduce(
      (
        current,
        sale
      ) => {

        const match =
          /^VENTA-(\d+)$/
            .exec(
              sale.number
            );


        if (!match) {
          return current;
        }


        return Math.max(
          current,
          Number(
            match[1]
          )
        );

      },
      0
    );


  return (
    "VENTA-" +
    String(
      maximum + 1
    ).padStart(
      6,
      "0"
    )
  );

}


// =====================================================
// FINALIZAR VENTA
// =====================================================

async function finishSale() {

  if (savingCloud) {
    return;
  }


  if (
    !cart.length
  ) {

    toast(
      "Agregá productos a la venta.",
      true
    );

    return;

  }


  // ===============================================
  // VOLVER A COMPROBAR EL STOCK
  // ===============================================

  for (
    const item of cart
  ) {

    const product =
      productById(
        item.productId
      );


    if (
      !product ||
      !Number.isSafeInteger(
        item.quantity
      ) ||
      item.quantity < 1 ||
      product.stock <
        item.quantity
    ) {

      toast(
        `No hay stock suficiente de ${item.name}. Revisá el carrito.`,
        true
      );

      return;

    }

  }


  // ===============================================
  // DATOS DEL CLIENTE
  // ===============================================

  const name =

    $("#saleClientName")
      .value
      .trim() ||

    "Consumidor final";


  const phone =

    $("#saleClientPhone")
      .value
      .trim();


  if (
    name.length > 120 ||
    phone.length > 40
  ) {

    toast(
      "Revisá los datos del cliente.",
      true
    );

    return;

  }


  let customerId =
    "";


  // ===============================================
  // GUARDAR CLIENTE AUTOMÁTICAMENTE
  // SI LA VENTA TIENE NOMBRE
  // ===============================================

  if (
    name !==
    "Consumidor final"
  ) {

    let customer =
      customerById(
        $("#saleClientSelect")
          .value
      );


    // Si modificaron el nombre
    // después de seleccionar uno,
    // lo buscamos nuevamente.

    if (
      !customer ||
      customer.name !== name
    ) {

      customer =
        state.customers.find(
          item =>

            item.name
              .toLocaleLowerCase(
                "es"
              ) ===

            name
              .toLocaleLowerCase(
                "es"
              ) &&

            (
              !phone ||
              !item.phone ||
              item.phone === phone
            )
        );

    }


    // Si no existe, crear cliente.

    if (!customer) {

      customer = {

        id:
          uuid(),

        name,

        phone,

        email:
          "",

        notes:
          ""

      };


      state.customers.push(
        customer
      );

    }


    customerId =
      customer.id;

  }


  // ===============================================
  // CREAR VENTA
  // ===============================================

  const number =
    saleNumber();


  const items =
    cart.map(
      item => ({
        ...item
      })
    );


  const sale = {

    id:
      uuid(),

    number,

    date:
      new Date()
        .toISOString(),

    customerId,

    customerName:
      name,

    customerPhone:
      phone,

    status:
      "active",

    cancelledAt:
      "",

    items,

    total:
      items.reduce(
        (
          sum,
          item
        ) =>
          sum +
          item.quantity *
          item.price,
        0
      )

  };


  // ===============================================
  // DESCONTAR STOCK
  // ===============================================

  for (
    const item of items
  ) {

    const product =
      productById(
        item.productId
      );


    product.stock -=
      item.quantity;


    state.movements.unshift(

      movement(

        product,

        "sale",

        item.quantity,

        `${number} · ${name}`

      )

    );

  }


  // ===============================================
  // GUARDAR VENTA
  // ===============================================

  state.sales.unshift(
    sale
  );


  const saved =
    await save();


  if (!saved) {

    // save() ya devuelve el estado
    // al valor anterior si falla.

    return;

  }


  // ===============================================
  // LIMPIAR LA VENTA ACTUAL
  // ===============================================

  cart = [];


  clearSelectedProduct();


  $("#saleClientName")
    .value =
      "";


  $("#saleClientPhone")
    .value =
      "";


  $("#saleClientSelect")
    .value =
      "";


  render();

  renderCart();


  saleCompleted(
    sale
  );

}


// =====================================================
// VENTA TERMINADA
// =====================================================

function saleCompleted(
  sale
) {

  const previous =
    $("#saleCompletedModal");


  if (previous) {
    previous.remove();
  }


  const modal =
    document.createElement(
      "div"
    );


  modal.id =
    "saleCompletedModal";


  modal.className =
    "modal";


  modal.innerHTML = `

    <div
      class="modal-backdrop"
      data-finish-close
    ></div>


    <div
      class="modal-card"
      role="dialog"
      aria-modal="true"
    >

      <h3>
        ✅ Venta registrada
      </h3>


      <p>

        ${esc(sale.number)}

        · Total:

        <strong>
          ${money(sale.total)}
        </strong>

      </p>


      <div class="modal-actions">

        <button
          type="button"
          class="btn secondary"
          data-finish-close
        >
          Cerrar
        </button>


        <button
          type="button"
          class="btn primary"
          id="printCompletedSale"
        >
          🖨️ Imprimir ticket
        </button>

      </div>

    </div>

  `;


  document.body.appendChild(
    modal
  );


  modal
    .querySelectorAll(
      "[data-finish-close]"
    )
    .forEach(
      button => {

        button.addEventListener(
          "click",
          () =>
            modal.remove()
        );

      }
    );


  modal
    .querySelector(
      "#printCompletedSale"
    )
    .addEventListener(
      "click",
      () =>
        printTicket(
          sale
        )
    );

}


// =====================================================
// IMPRIMIR TICKET
// =====================================================

function printTicket(
  sale
) {

  const printWindow =
    window.open(
      "",
      "_blank",
      "width=510,height=760"
    );


  if (
    !printWindow
  ) {

    toast(
      "El navegador bloqueó el ticket. Permití ventanas emergentes para imprimir.",
      true
    );

    return;

  }


  const rows =
    sale.items
      .map(
        item => `

          <tr>

            <td>

              ${esc(item.name)}

              <small>
                ${esc(item.code)}
              </small>

            </td>


            <td>
              ${item.quantity}
            </td>


            <td>
              ${money(item.price)}
            </td>


            <td>
              ${
                money(
                  item.price *
                  item.quantity
                )
              }
            </td>

          </tr>

        `
      )
      .join("");


  printWindow.document.open();


  printWindow.document.write(`

    <!doctype html>

    <html lang="es">

    <head>

      <meta charset="utf-8">

      <meta
        name="viewport"
        content="width=device-width, initial-scale=1"
      >

      <title>
        ${esc(sale.number)}
      </title>


      <style>

        * {
          box-sizing:
            border-box;
        }


        body {

          max-width:
            450px;

          margin:
            20px auto;

          padding:
            15px;

          color:
            #111;

          font-family:
            Arial,
            sans-serif;

          font-size:
            13px;

        }


        .ticket-header {

          padding-bottom:
            16px;

          border-bottom:
            1px dashed #888;

          text-align:
            center;

        }


        .logo {

          margin:
            0;

          color:
            #0d477f;

          font-size:
            24px;

          font-weight:
            900;

        }


        .logo span {

          color:
            #4b9f34;

        }


        .subtitle {

          margin-top:
            5px;

          color:
            #555;

          font-size:
            12px;

        }


        .sale-data {

          margin:
            18px 0;

          line-height:
            1.7;

        }


        table {

          width:
            100%;

          margin-top:
            18px;

          border-collapse:
            collapse;

        }


        th,
        td {

          padding:
            8px 3px;

          border-bottom:
            1px solid #ddd;

          vertical-align:
            top;

          text-align:
            left;

          font-size:
            11px;

        }


        th:nth-child(2),
        td:nth-child(2) {

          text-align:
            center;

        }


        th:nth-child(3),
        td:nth-child(3),
        th:nth-child(4),
        td:nth-child(4) {

          text-align:
            right;

        }


        td small {

          display:
            block;

          margin-top:
            3px;

          color:
            #777;

          font-size:
            9px;

        }


        .ticket-total {

          display:
            flex;

          justify-content:
            space-between;

          align-items:
            center;

          margin-top:
            20px;

          padding-top:
            15px;

          border-top:
            2px dashed #222;

          font-size:
            20px;

          font-weight:
            bold;

        }


        .thanks {

          margin-top:
            28px;

          text-align:
            center;

          line-height:
            1.6;

        }


        .fiscal-notice {

          margin-top:
            8px;

          color:
            #666;

          font-size:
            10px;

          text-align:
            center;

        }


        .no-print {

          margin-top:
            25px;

          text-align:
            center;

        }


        button {

          padding:
            11px 20px;

          border:
            0;

          border-radius:
            8px;

          background:
            #0d477f;

          color:
            white;

          cursor:
            pointer;

          font-size:
            14px;

          font-weight:
            bold;

        }


        @media print {

          body {

            max-width:
              none;

            margin:
              0;

          }


          .no-print {

            display:
              none;

          }

        }

      </style>

    </head>


    <body>


      <div class="ticket-header">

        <div class="logo">

          PAPELERA

          <span>
            ACCORD
          </span>

        </div>


        <div class="subtitle">
          Todo para tus ideas
        </div>

      </div>


      <div class="sale-data">

        <strong>
          ${esc(sale.number)}
        </strong>

        <br>


        Fecha:
        ${dateTime(sale.date)}

        <br>


        Cliente:
        ${esc(sale.customerName)}


        ${
          sale.customerPhone

            ? `
                <br>

                Teléfono:
                ${esc(
                  sale.customerPhone
                )}
              `

            : ""
        }


        <br>


        Estado:

        ${
          sale.status ===
          "cancelled"

            ? "ANULADA"

            : "Confirmada"
        }

      </div>


      <table>

        <thead>

          <tr>

            <th>
              Producto
            </th>

            <th>
              Cant.
            </th>

            <th>
              Precio
            </th>

            <th>
              Subtotal
            </th>

          </tr>

        </thead>


        <tbody>

          ${rows}

        </tbody>

      </table>


      <div class="ticket-total">

        <span>
          TOTAL
        </span>

        <span>
          ${money(sale.total)}
        </span>

      </div>


      <div class="thanks">

        <strong>
          ¡Gracias por tu compra!
        </strong>

      </div>


      <div class="fiscal-notice">

        Comprobante interno.
        No válido como factura fiscal.

      </div>


      <div class="no-print">

        <button
          onclick="window.print()"
        >
          Imprimir ticket
        </button>

      </div>


    </body>

    </html>

  `);


  printWindow.document.close();

  printWindow.focus();

}


// =====================================================
// CLIENTES DISPONIBLES EN LA VENTA
// =====================================================

function renderClientOptions() {

  const select =
    $("#saleClientSelect");


  const previous =
    select.value;


  select.innerHTML =

    `
      <option value="">
        Consumidor final / ingresar nuevo
      </option>
    ` +

    [...state.customers]

      .sort(
        (
          a,
          b
        ) =>
          a.name.localeCompare(
            b.name,
            "es"
          )
      )

      .map(
        customer => `

          <option
            value="${esc(customer.id)}"
          >

            ${esc(customer.name)}

            ${
              customer.phone

                ? " · " +
                  esc(
                    customer.phone
                  )

                : ""
            }

          </option>

        `
      )

      .join("");


  if (
    customerById(
      previous
    )
  ) {

    select.value =
      previous;

  }

}


// =====================================================
// SELECCIONAR CLIENTE EN UNA VENTA
// =====================================================

function selectClient() {

  const customer =
    customerById(
      $("#saleClientSelect")
        .value
    );


  $("#saleClientName")
    .value =
      customer?.name ||
      "";


  $("#saleClientPhone")
    .value =
      customer?.phone ||
      "";

}// =====================================================
// GUARDAR CLIENTE DESDE REGISTRAR VENTA
// =====================================================

async function saveClientFromSale() {

  if (savingCloud) {
    return;
  }


  const name =
    $("#saleClientName")
      .value
      .trim();


  const phone =
    $("#saleClientPhone")
      .value
      .trim();


  if (
    !name ||
    name.length > 120 ||
    phone.length > 40
  ) {

    toast(
      "Ingresá el nombre del cliente y revisá los datos.",
      true
    );

    return;

  }


  let customer =

    customerById(
      $("#saleClientSelect")
        .value
    ) ||

    state.customers.find(
      item =>

        item.name
          .toLocaleLowerCase("es") ===

        name
          .toLocaleLowerCase("es") &&

        item.phone === phone
    );


  // ===================================================
  // SI EL CLIENTE YA EXISTE
  // ===================================================

  if (customer) {

    const duplicated =
      state.customers.some(
        item =>

          item.id !== customer.id &&

          item.name
            .toLocaleLowerCase("es") ===

          name
            .toLocaleLowerCase("es") &&

          item.phone === phone
      );


    if (duplicated) {

      toast(
        "Ya existe ese cliente.",
        true
      );

      return;

    }


    Object.assign(
      customer,
      {
        name,
        phone
      }
    );

  }


  // ===================================================
  // CLIENTE NUEVO
  // ===================================================

  else {

    customer = {

      id:
        uuid(),

      name,

      phone,

      email:
        "",

      notes:
        ""

    };


    state.customers.push(
      customer
    );

  }


  // ===================================================
  // GUARDAR EN SUPABASE
  // ===================================================

  const saved =
    await save();


  if (!saved) {
    return;
  }


  render();


  $("#saleClientSelect")
    .value =
      customer.id;


  toast(
    "Cliente guardado en la agenda."
  );

}


// =====================================================
// LIMPIAR FORMULARIO DE CLIENTE
// =====================================================

function resetClient() {

  $("#customerForm")
    .reset();


  $("#customerId")
    .value =
      "";


  $("#customerFormTitle")
    .textContent =
      "Nuevo cliente";


  $("#customerSubmitBtn")
    .textContent =
      "Guardar cliente";


  $("#cancelCustomerEdit")
    .classList.add(
      "hidden"
    );

}


// =====================================================
// GUARDAR / EDITAR CLIENTE
// =====================================================

async function saveClient(
  event
) {

  event.preventDefault();


  if (savingCloud) {
    return;
  }


  const id =
    $("#customerId")
      .value;


  const name =
    $("#customerName")
      .value
      .trim();


  const phone =
    $("#customerPhone")
      .value
      .trim();


  const email =
    $("#customerEmail")
      .value
      .trim();


  const notes =
    $("#customerNotes")
      .value
      .trim();


  // ===================================================
  // VALIDAR
  // ===================================================

  if (
    !name ||
    name.length > 120 ||
    phone.length > 40 ||
    email.length > 160 ||
    notes.length > 400
  ) {

    toast(
      "Revisá los datos del cliente.",
      true
    );

    return;

  }


  // ===================================================
  // EVITAR CLIENTES DUPLICADOS
  // ===================================================

  const duplicated =
    state.customers.some(
      customer =>

        customer.id !== id &&

        customer.name
          .toLocaleLowerCase("es") ===

        name
          .toLocaleLowerCase("es") &&

        customer.phone === phone
    );


  if (duplicated) {

    toast(
      "El cliente ya existe.",
      true
    );

    return;

  }


  // ===================================================
  // EDITAR
  // ===================================================

  if (id) {

    const customer =
      customerById(
        id
      );


    if (!customer) {

      toast(
        "No encontramos el cliente.",
        true
      );

      return;

    }


    Object.assign(
      customer,
      {
        name,
        phone,
        email,
        notes
      }
    );

  }


  // ===================================================
  // NUEVO
  // ===================================================

  else {

    state.customers.push({

      id:
        uuid(),

      name,

      phone,

      email,

      notes

    });

  }


  // ===================================================
  // GUARDAR
  // ===================================================

  const saved =
    await save();


  if (!saved) {
    return;
  }


  resetClient();

  render();


  toast(
    id
      ? "Cliente actualizado."
      : "Cliente guardado."
  );

}


// =====================================================
// MOSTRAR CLIENTES
// =====================================================

function renderClients() {

  const term =

    $("#customerSearch")

      .value

      .trim()

      .toLocaleLowerCase(
        "es"
      );


  const customers =

    [...state.customers]

      .filter(
        customer =>

          [
            customer.name,
            customer.phone,
            customer.email
          ]

            .join(" ")

            .toLocaleLowerCase(
              "es"
            )

            .includes(
              term
            )
      )

      .sort(
        (
          a,
          b
        ) =>
          a.name.localeCompare(
            b.name,
            "es"
          )
      );


  $("#customerCountText")
    .textContent =

      `${customers.length} ` +

      (
        customers.length === 1
          ? "cliente"
          : "clientes"
      );


  $("#customersTable")
    .innerHTML =

      customers
        .map(
          customer => {

            const saleCount =
              state.sales.filter(
                sale =>

                  sale.customerId ===
                    customer.id &&

                  sale.status !==
                    "cancelled"
              ).length;


            return `

              <tr>

                <td>

                  <strong>
                    ${esc(customer.name)}
                  </strong>

                </td>


                <td>
                  ${esc(customer.phone || "—")}
                </td>


                <td>
                  ${esc(customer.email || "—")}
                </td>


                <td>
                  ${saleCount}
                </td>


                <td>

                  <button
                    type="button"
                    class="action-btn"
                    data-client-action="edit"
                    data-id="${esc(customer.id)}"
                  >
                    Editar
                  </button>


                  <button
                    type="button"
                    class="action-btn delete"
                    data-client-action="delete"
                    data-id="${esc(customer.id)}"
                  >
                    Eliminar
                  </button>

                </td>

              </tr>

            `;

          }
        )
        .join("") ||

      emptyRow(
        5,
        "Todavía no hay clientes para mostrar."
      );

}


// =====================================================
// EDITAR / ELIMINAR CLIENTE
// =====================================================

function clientActions(
  event
) {

  const button =
    event.target.closest(
      "[data-client-action]"
    );


  if (!button) {
    return;
  }


  const customer =
    customerById(
      button.dataset.id
    );


  if (!customer) {
    return;
  }


  // ===================================================
  // EDITAR
  // ===================================================

  if (
    button.dataset.clientAction ===
    "edit"
  ) {

    $("#customerId")
      .value =
        customer.id;


    $("#customerName")
      .value =
        customer.name;


    $("#customerPhone")
      .value =
        customer.phone;


    $("#customerEmail")
      .value =
        customer.email;


    $("#customerNotes")
      .value =
        customer.notes;


    $("#customerFormTitle")
      .textContent =
        "Editar cliente";


    $("#customerSubmitBtn")
      .textContent =
        "Guardar cambios";


    $("#cancelCustomerEdit")
      .classList.remove(
        "hidden"
      );


    $("#customerName")
      .focus();


    return;

  }


  // ===================================================
  // ELIMINAR
  // ===================================================

  confirmAction(

    `¿Eliminar a “${customer.name}” de la agenda? Sus ventas históricas se conservarán.`,

    async () => {

      if (savingCloud) {
        return;
      }


      state.customers =
        state.customers.filter(
          item =>
            item.id !==
            customer.id
        );


      const saved =
        await save();


      if (!saved) {
        return;
      }


      if (
        $("#customerId")
          .value ===
        customer.id
      ) {

        resetClient();

      }


      if (
        $("#saleClientSelect")
          .value ===
        customer.id
      ) {

        $("#saleClientSelect")
          .value =
            "";

      }


      render();


      toast(
        "Cliente eliminado de la agenda."
      );

    }

  );

}


// =====================================================
// VISTA PREVIA DE STOCK
// =====================================================

function entryPreview() {

  const product =
    productById(
      $("#entryProduct")
        .value
    );


  $("#entryStockPreview")
    .innerHTML = `

      <span>
        Stock actual
      </span>

      <strong>
        ${
          product
            ? product.stock
            : 0
        }
        unidades
      </strong>

    `;

}


// =====================================================
// INGRESAR MERCADERÍA
// =====================================================

async function addEntry(
  event
) {

  event.preventDefault();


  if (savingCloud) {
    return;
  }


  const product =
    productById(
      $("#entryProduct")
        .value
    );


  const quantity =
    Number(
      $("#entryQuantity")
        .value
    );


  const detail =
    $("#entryDetail")
      .value
      .trim();


  if (!product) {

    toast(
      "Seleccioná un producto.",
      true
    );

    return;

  }


  if (
    !Number.isSafeInteger(
      quantity
    ) ||
    quantity <= 0 ||
    product.stock +
      quantity >
      1000000000
  ) {

    toast(
      "Ingresá una cantidad entera válida.",
      true
    );

    return;

  }


  product.stock +=
    quantity;


  state.movements.unshift(

    movement(

      product,

      "entry",

      quantity,

      detail
        .slice(
          0,
          160
        ) ||
        "Ingreso de mercadería"

    )

  );


  const saved =
    await save();


  if (!saved) {
    return;
  }


  $("#entryQuantity")
    .value =
      1;


  $("#entryDetail")
    .value =
      "";


  render();


  $("#entryProduct")
    .value =
      product.id;


  entryPreview();


  toast(
    `Ingreso registrado. Stock actual: ${product.stock}.`
  );

}


// =====================================================
// MOVIMIENTOS
// =====================================================

function renderMovements() {

  const filter =
    $("#movementTypeFilter")
      .value;


  const movements =
    state.movements.filter(
      item =>
        !filter ||
        item.type === filter
    );


  $("#movementsTable")
    .innerHTML =

      movements
        .map(
          item => `

            <tr>

              <td>
                ${dateTime(item.date)}
              </td>


              <td>
                ${badgeMove(item.type)}
              </td>


              <td>
                ${esc(item.productName)}
              </td>


              <td
                class="${
                  item.delta < 0
                    ? "qty-negative"
                    : "qty-positive"
                }"
              >

                ${moveQty(item)}

              </td>


              <td>
                ${item.resultStock}
              </td>


              <td>
                ${esc(item.detail || "—")}
              </td>

            </tr>

          `
        )
        .join("") ||

      emptyRow(
        6,
        "No hay movimientos para mostrar."
      );

}


// =====================================================
// STOCK BAJO
// =====================================================

function renderLow() {

  const products =

    state.products

      .filter(
        product =>
          product.stock <=
          product.minStock
      )

      .sort(
        (
          a,
          b
        ) =>
          a.stock -
          b.stock
      );


  $("#lowStockTable")
    .innerHTML =

      products
        .map(
          product => `

            <tr>

              <td>
                ${esc(product.name)}
              </td>


              <td>
                ${esc(product.category)}
              </td>


              <td>
                ${product.stock}
              </td>


              <td>
                ${product.minStock}
              </td>


              <td>

                ${
                  Math.max(
                    product.minStock -
                    product.stock,
                    0
                  )
                }

              </td>


              <td>
                ${stockBadge(product)}
              </td>

            </tr>

          `
        )
        .join("") ||

      emptyRow(
        6,
        "No hay productos para reponer."
      );

}


// =====================================================
// AGRUPAR POR CATEGORÍA
// =====================================================

function categorySummary() {

  const categories =
    new Map();


  state.products
    .forEach(
      product => {

        const current =
          categories.get(
            product.category
          ) || {

            category:
              product.category,

            products:
              0,

            units:
              0

          };


        current.products +=
          1;


        current.units +=
          product.stock;


        categories.set(
          product.category,
          current
        );

      }
    );


  return [

    ...categories.values()

  ].sort(
    (
      a,
      b
    ) =>
      b.units -
      a.units
  );

}


// =====================================================
// MOSTRAR CATEGORÍAS
// =====================================================

function renderCategories() {

  const categories =
    categorySummary();


  $("#categoriesCards")
    .innerHTML =

      categories
        .map(
          category => `

            <article
              class="panel category-card"
            >

              <div
                class="category-icon"
              >
                🏷️
              </div>


              <h3>
                ${esc(category.category)}
              </h3>


              <div
                class="category-metrics"
              >

                <div>

                  <strong>
                    ${category.products}
                  </strong>

                  <span>
                    productos
                  </span>

                </div>


                <div>

                  <strong>
                    ${category.units}
                  </strong>

                  <span>
                    unidades
                  </span>

                </div>

              </div>

            </article>

          `
        )
        .join("") ||

      `
        <div
          class="panel empty-cell"
        >
          Todavía no hay categorías.
        </div>
      `;

}


// =====================================================
// REPORTES
// =====================================================

function renderReports() {

  // Solamente contamos ventas
  // que NO estén anuladas.

  const activeSales =
    state.sales.filter(
      sale =>
        sale.status !==
        "cancelled"
    );


  // ===================================================
  // UNIDADES ACTUALES EN STOCK
  // ===================================================

  const stockUnits =
    state.products.reduce(
      (
        total,
        product
      ) =>
        total +
        product.stock,
      0
    );


  // ===================================================
  // UNIDADES VENDIDAS
  // ===================================================

  const soldUnits =
    activeSales.reduce(
      (
        total,
        sale
      ) =>

        total +

        sale.items.reduce(
          (
            subtotal,
            item
          ) =>
            subtotal +
            item.quantity,
          0
        ),

      0
    );


  // ===================================================
  // UNIDADES INGRESADAS
  // ===================================================

  const enteredUnits =

    state.movements

      .filter(
        item =>
          item.type ===
          "entry"
      )

      .reduce(
        (
          total,
          item
        ) =>
          total +
          item.quantity,
        0
      );


  // ===================================================
  // VALOR DEL STOCK
  // ===================================================

  const stockValue =
    state.products.reduce(
      (
        total,
        product
      ) =>

        total +

        product.stock *
        product.price,

      0
    );


  // ===================================================
  // FACTURACIÓN
  // ===================================================

  const revenue =
    activeSales.reduce(
      (
        total,
        sale
      ) =>
        total +
        sale.total,
      0
    );


  $("#reportUnits")
    .textContent =
      stockUnits
        .toLocaleString(
          "es-AR"
        );


  $("#reportSoldUnits")
    .textContent =
      soldUnits
        .toLocaleString(
          "es-AR"
        );


  $("#reportEntryUnits")
    .textContent =
      enteredUnits
        .toLocaleString(
          "es-AR"
        );


  $("#reportStockValue")
    .textContent =
      money(
        stockValue
      );


  $("#reportSalesCount")
    .textContent =
      activeSales.length;


  $("#reportRevenue")
    .textContent =
      money(
        revenue
      );


  // ===================================================
  // PRODUCTOS MÁS VENDIDOS
  // ===================================================

  const soldProducts =
    new Map();


  activeSales.forEach(
    sale => {

      sale.items.forEach(
        item => {

          const previous =
            soldProducts.get(
              item.productId
            ) || {

              name:
                item.name,

              qty:
                0

            };


          previous.qty +=
            item.quantity;


          soldProducts.set(
            item.productId,
            previous
          );

        }
      );

    }
  );


  const topProducts = [

    ...soldProducts.values()

  ]

    .sort(
      (
        a,
        b
      ) =>
        b.qty -
        a.qty
    )

    .slice(
      0,
      6
    );


  const maximum =
    topProducts[0]?.qty ||
    1;


  $("#topProductsList")
    .innerHTML =

      topProducts
        .map(
          product => {

            const percentage =
              Math.max(
                8,
                product.qty /
                maximum *
                100
              );


            return `

              <div
                class="top-product-row"
              >

                <span>
                  ${esc(product.name)}
                </span>


                <div
                  class="progress"
                >

                  <i
                    style="
                      width:
                      ${percentage}%
                    "
                  ></i>

                </div>


                <strong>
                  ${product.qty} u.
                </strong>

              </div>

            `;

          }
        )
        .join("") ||

      `
        <div
          class="empty-cell"
        >
          Todavía no hay ventas para analizar.
        </div>
      `;

}// =====================================================
// HISTORIAL DE VENTAS
// =====================================================

function renderSales() {

  const term =
    $("#salesSearch")
      .value
      .trim()
      .toLocaleLowerCase("es");


  const filter =
    $("#salesStatusFilter")
      .value;


  const sales =
    state.sales.filter(
      sale => {

        const matchesStatus =
          !filter ||
          sale.status === filter;


        const searchableText = [

          sale.number,

          sale.customerName,

          sale.customerPhone,

          ...sale.items.map(
            item =>
              item.name
          )

        ]
          .join(" ")
          .toLocaleLowerCase("es");


        const matchesSearch =
          searchableText.includes(
            term
          );


        return (
          matchesStatus &&
          matchesSearch
        );

      }
    );


  $("#salesHistoryTable")
    .innerHTML =

      sales
        .map(
          sale => {

            const units =
              sale.items.reduce(
                (
                  total,
                  item
                ) =>
                  total +
                  item.quantity,
                0
              );


            return `

              <tr>

                <td>
                  <strong>
                    ${esc(sale.number)}
                  </strong>
                </td>


                <td>
                  ${dateTime(sale.date)}
                </td>


                <td>
                  ${esc(sale.customerName)}
                </td>


                <td>
                  ${units} u.
                  (${sale.items.length} tipos)
                </td>


                <td>
                  ${money(sale.total)}
                </td>


                <td>

                  <span
                    class="badge ${
                      sale.status === "cancelled"
                        ? "cancelled"
                        : "ok"
                    }"
                  >

                    ${
                      sale.status === "cancelled"
                        ? "Anulada"
                        : "Confirmada"
                    }

                  </span>

                </td>


                <td>

                  <button
                    type="button"
                    class="action-btn"
                    data-sale-action="print"
                    data-id="${esc(sale.id)}"
                  >
                    Ticket
                  </button>


                  ${
                    sale.status ===
                    "cancelled"

                      ? ""

                      : `

                        <button
                          type="button"
                          class="action-btn delete"
                          data-sale-action="cancel"
                          data-id="${esc(sale.id)}"
                        >
                          Anular
                        </button>

                      `
                  }

                </td>

              </tr>

            `;

          }
        )
        .join("") ||

      emptyRow(
        7,
        "Todavía no hay ventas para mostrar."
      );

}


// =====================================================
// REIMPRIMIR / ANULAR VENTA
// =====================================================

function saleActions(
  event
) {

  const button =
    event.target.closest(
      "[data-sale-action]"
    );


  if (!button) {
    return;
  }


  const sale =
    state.sales.find(
      item =>
        item.id ===
        button.dataset.id
    );


  if (!sale) {
    return;
  }


  // ===================================================
  // IMPRIMIR
  // ===================================================

  if (
    button.dataset.saleAction ===
    "print"
  ) {

    printTicket(
      sale
    );

    return;

  }


  if (
    sale.status ===
    "cancelled"
  ) {
    return;
  }


  // ===================================================
  // ANULAR
  // ===================================================

  confirmAction(

    `¿Anular ${sale.number}? Los productos existentes se devolverán al stock.`,

    async () => {

      if (savingCloud) {
        return;
      }


      // Comprobar que el stock
      // no supere el límite.

      for (
        const item of sale.items
      ) {

        const product =
          productById(
            item.productId
          );


        if (
          product &&
          product.stock +
            item.quantity >
            1000000000
        ) {

          toast(
            "Cantidad demasiado grande para reponer.",
            true
          );

          return;

        }

      }


      sale.status =
        "cancelled";


      sale.cancelledAt =
        new Date()
          .toISOString();


      // Devolver mercadería

      for (
        const item of sale.items
      ) {

        const product =
          productById(
            item.productId
          );


        // Puede haber productos
        // históricos ya eliminados.

        if (!product) {
          continue;
        }


        product.stock +=
          item.quantity;


        state.movements.unshift(

          movement(

            product,

            "return",

            item.quantity,

            `Anulación ${sale.number}`

          )

        );

      }


      const saved =
        await save();


      if (!saved) {
        return;
      }


      render();


      toast(
        "Venta anulada. El stock fue devuelto."
      );

    }

  );

}


// =====================================================
// DESCARGAR ARCHIVOS
// =====================================================

function download(
  content,
  filename,
  mime
) {

  const blob =
    new Blob(
      [content],
      {
        type: mime
      }
    );


  const url =
    URL.createObjectURL(
      blob
    );


  const link =
    document.createElement(
      "a"
    );


  link.href =
    url;


  link.download =
    filename;


  document.body
    .appendChild(
      link
    );


  link.click();

  link.remove();


  setTimeout(
    () =>
      URL.revokeObjectURL(
        url
      ),
    1000
  );

}


// =====================================================
// GENERAR CSV
// =====================================================

function csv(
  headers,
  rows
) {

  const safeValue =
    value => {

      if (
        typeof value ===
          "string" &&

        /^\s*[=+@\-\t\r]/
          .test(value)
      ) {

        return (
          "'" +
          value
        );

      }


      return value;

    };


  const quote =
    value => {

      const text =
        String(
          safeValue(
            value
          ) ?? ""
        );


      if (
        /[;"\r\n]/
          .test(text)
      ) {

        return (
          '"' +
          text.replaceAll(
            '"',
            '""'
          ) +
          '"'
        );

      }


      return text;

    };


  return (

    "\uFEFF" +

    [
      headers,
      ...rows
    ]
      .map(
        row =>
          row
            .map(
              quote
            )
            .join(";")
      )
      .join("\r\n")

  );

}


// =====================================================
// EXPORTAR PRODUCTOS CSV
// =====================================================

function productsCsv() {

  const content =
    csv(

      [
        "Código",
        "Producto",
        "Categoría",
        "Stock",
        "Stock mínimo",
        "Precio venta"
      ],

      state.products.map(
        product => [

          product.code,

          product.name,

          product.category,

          product.stock,

          product.minStock,

          product.price

        ]
      )

    );


  download(

    content,

    `productos-accord-${dayKey(new Date())}.csv`,

    "text/csv;charset=utf-8"

  );

}


// =====================================================
// EXPORTAR MOVIMIENTOS CSV
// =====================================================

function movementsCsv() {

  const content =
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

      state.movements.map(
        item => [

          dateTime(
            item.date
          ),

          item.type,

          item.productCode,

          item.productName,

          item.delta,

          item.resultStock,

          item.detail

        ]
      )

    );


  download(

    content,

    `movimientos-accord-${dayKey(new Date())}.csv`,

    "text/csv;charset=utf-8"

  );

}


// =====================================================
// EXPORTAR VENTAS CSV
// =====================================================

function salesCsv() {

  const content =
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

      state.sales.map(
        sale => [

          sale.number,

          dateTime(
            sale.date
          ),

          sale.customerName,

          sale.customerPhone,

          sale.items
            .map(
              item =>
                `${item.name} x${item.quantity}`
            )
            .join(" | "),

          sale.items.reduce(
            (
              total,
              item
            ) =>
              total +
              item.quantity,
            0
          ),

          sale.total,

          sale.status ===
          "cancelled"
            ? "Anulada"
            : "Confirmada"

        ]
      )

    );


  download(

    content,

    `ventas-accord-${dayKey(new Date())}.csv`,

    "text/csv;charset=utf-8"

  );

}


// =====================================================
// DESCARGAR RESPALDO JSON
// =====================================================

function exportBackup() {

  const backup = {

    app:
      "papelera-accord",

    version:
      2,

    createdAt:
      new Date()
        .toISOString(),

    data:
      state

  };


  download(

    JSON.stringify(
      backup,
      null,
      2
    ),

    `respaldo-accord-${dayKey(new Date())}.json`,

    "application/json;charset=utf-8"

  );


  toast(
    "Respaldo descargado. Guardalo en un lugar seguro."
  );

}


// =====================================================
// LIMPIAR FORMULARIOS
// =====================================================

function clearForms() {

  cart = [];

  selectedProductId =
    "";


  resetProduct();

  resetClient();


  $("#saleClientName")
    .value =
      "";


  $("#saleClientPhone")
    .value =
      "";


  $("#saleClientSelect")
    .value =
      "";


  clearSelectedProduct();


  $("#globalSearch")
    .value =
      "";


  search =
    "";


  $("#customerSearch")
    .value =
      "";


  $("#salesSearch")
    .value =
      "";


  $("#productCategoryFilter")
    .value =
      "";


  $("#productStatusFilter")
    .value =
      "";


  $("#salesStatusFilter")
    .value =
      "";


  $("#movementTypeFilter")
    .value =
      "";


  $("#entryQuantity")
    .value =
      1;


  $("#entryDetail")
    .value =
      "";

}


// =====================================================
// RESTAURAR RESPALDO
// =====================================================

async function importBackup() {

  if (savingCloud) {
    return;
  }


  const file =
    $("#importBackupFile")
      .files?.[0];


  if (!file) {

    toast(
      "Seleccioná un respaldo JSON.",
      true
    );

    return;

  }


  if (
    file.size >
    10 * 1024 * 1024
  ) {

    toast(
      "El archivo supera 10 MB.",
      true
    );

    return;

  }


  let restored;


  try {

    const content =
      JSON.parse(
        await file.text()
      );


    if (
      content.app !==
        "papelera-accord" ||

      content.version !==
        2
    ) {

      throw new Error(
        "El archivo no corresponde a este sistema."
      );

    }


    restored =
      validateData(
        content.data
      );

  } catch (
    error
  ) {

    toast(
      `Respaldo inválido: ${error.message}`,
      true
    );

    return;

  }


  confirmAction(

    `¿Reemplazar todos los datos actuales con este respaldo? Contiene ${restored.products.length} productos, ${restored.customers.length} clientes y ${restored.sales.length} ventas.`,

    async () => {

      if (savingCloud) {
        return;
      }


      state =
        restored;


      const saved =
        await save();


      if (!saved) {
        return;
      }


      clearForms();

      render();

      renderCart();


      $("#importBackupFile")
        .value =
          "";


      toast(
        "Respaldo restaurado en la nube."
      );

    }

  );

}


// =====================================================
// BORRAR TODOS LOS DATOS
// =====================================================

function resetAll() {

  confirmAction(

    "Vas a borrar todos los productos, clientes, ventas y movimientos de la nube para ambas cuentas. ¿Continuar?",

    async () => {

      if (savingCloud) {
        return;
      }


      const confirmation =
        prompt(
          "Para confirmar el borrado irreversible, escribí BORRAR:"
        );


      if (
        confirmation !==
        "BORRAR"
      ) {

        toast(
          "Borrado cancelado."
        );

        return;

      }


      state =
        emptyData();


      const saved =
        await save();


      if (!saved) {
        return;
      }


      clearForms();

      render();

      renderCart();

      nav(
        "dashboard"
      );


      toast(
        "Todos los datos fueron eliminados."
      );

    }

  );

}


// =====================================================
// SINCRONIZAR CARRITO CON INVENTARIO
// =====================================================

function syncCartWithState() {

  cart =
    cart
      .map(
        item => {

          const product =
            productById(
              item.productId
            );


          if (
            !product ||
            product.stock <= 0
          ) {
            return null;
          }


          return {

            productId:
              product.id,

            code:
              product.code,

            name:
              product.name,

            price:
              product.price,

            quantity:
              Math.min(
                item.quantity,
                product.stock
              )

          };

        }
      )
      .filter(
        Boolean
      );


  if (
    selectedProductId &&
    !productById(
      selectedProductId
    )
  ) {

    clearSelectedProduct();

  }

}


// =====================================================
// CONECTAR BOTONES Y EVENTOS
// =====================================================

function bind() {

  // ===================================================
  // NAVEGACIÓN
  // ===================================================

  $$(".nav-item")
    .forEach(
      button => {

        button.addEventListener(
          "click",
          () =>
            nav(
              button.dataset.section
            )
        );

      }
    );


  $$("[data-go]")
    .forEach(
      button => {

        button.addEventListener(
          "click",
          () =>
            nav(
              button.dataset.go
            )
        );

      }
    );


  // ===================================================
  // BUSCADOR GENERAL
  // ===================================================

  $("#globalSearch")
    .addEventListener(
      "input",
      event => {

        search =
          event.target
            .value
            .trim()
            .toLocaleLowerCase(
              "es"
            );


        renderProducts();


        if (search) {

          nav(
            "products"
          );

        }

      }
    );


  // ===================================================
  // PRODUCTOS
  // ===================================================

  $("#productForm")
    .addEventListener(
      "submit",
      saveProduct
    );


  $("#cancelEditBtn")
    .addEventListener(
      "click",
      resetProduct
    );


  $("#productsTable")
    .addEventListener(
      "click",
      productActions
    );


  $("#productCategoryFilter")
    .addEventListener(
      "change",
      renderProducts
    );


  $("#productStatusFilter")
    .addEventListener(
      "change",
      renderProducts
    );


  // ===================================================
  // CLIENTE EN VENTA
  // ===================================================

  $("#saleClientSelect")
    .addEventListener(
      "change",
      selectClient
    );


  $("#saveSaleCustomer")
    .addEventListener(
      "click",
      saveClientFromSale
    );


  $("#saleClientName")
    .addEventListener(
      "input",
      () => {

        const customer =
          customerById(
            $("#saleClientSelect")
              .value
          );


        if (
          customer &&
          customer.name !==
            $("#saleClientName")
              .value
              .trim()
        ) {

          $("#saleClientSelect")
            .value =
              "";

        }

      }
    );


  // ===================================================
  // BUSCADOR DE PRODUCTOS DE LA VENTA
  // ===================================================

  $("#saleProductSearch")
    .addEventListener(
      "input",
      findSaleProducts
    );


  $("#saleSearchResults")
    .addEventListener(
      "click",
      event => {

        const result =
          event.target.closest(
            "[data-sale-product-id]"
          );


        if (result) {

          selectSaleProduct(
            result.dataset
              .saleProductId
          );

        }

      }
    );


  document.addEventListener(
    "click",
    event => {

      if (
        !event.target.closest(
          ".product-sale-search"
        )
      ) {

        $("#saleSearchResults")
          .classList.add(
            "hidden"
          );

      }

    }
  );


  // ===================================================
  // CARRITO
  // ===================================================

  $("#addProductToSale")
    .addEventListener(
      "click",
      addToCart
    );


  $("#saleCartTable")
    .addEventListener(
      "click",
      cartAction
    );


  $("#saleCartTable")
    .addEventListener(
      "change",
      cartQuantity
    );


  $("#clearSaleCart")
    .addEventListener(
      "click",
      clearCart
    );


  $("#finishSaleButton")
    .addEventListener(
      "click",
      finishSale
    );


  // ===================================================
  // CLIENTES
  // ===================================================

  $("#customerForm")
    .addEventListener(
      "submit",
      saveClient
    );


  $("#cancelCustomerEdit")
    .addEventListener(
      "click",
      resetClient
    );


  $("#customerSearch")
    .addEventListener(
      "input",
      renderClients
    );


  $("#customersTable")
    .addEventListener(
      "click",
      clientActions
    );


  // ===================================================
  // INGRESO DE MERCADERÍA
  // ===================================================

  $("#entryProduct")
    .addEventListener(
      "change",
      entryPreview
    );


  $("#entryForm")
    .addEventListener(
      "submit",
      addEntry
    );


  // ===================================================
  // MOVIMIENTOS
  // ===================================================

  $("#movementTypeFilter")
    .addEventListener(
      "change",
      renderMovements
    );


  // ===================================================
  // HISTORIAL DE VENTAS
  // ===================================================

  $("#salesSearch")
    .addEventListener(
      "input",
      renderSales
    );


  $("#salesStatusFilter")
    .addEventListener(
      "change",
      renderSales
    );


  $("#salesHistoryTable")
    .addEventListener(
      "click",
      saleActions
    );


  // ===================================================
  // EXPORTACIONES
  // ===================================================

  $("#downloadMovementsCsv")
    .addEventListener(
      "click",
      movementsCsv
    );


  $("#downloadProductsCsv")
    .addEventListener(
      "click",
      productsCsv
    );


  $("#downloadSalesCsv")
    .addEventListener(
      "click",
      salesCsv
    );


  // ===================================================
  // RESPALDOS
  // ===================================================

  $("#exportBackup")
    .addEventListener(
      "click",
      exportBackup
    );


  $("#importBackup")
    .addEventListener(
      "click",
      importBackup
    );


  $("#resetAllData")
    .addEventListener(
      "click",
      resetAll
    );


  // ===================================================
  // MODAL DE CONFIRMACIÓN
  // ===================================================

  $("#confirmActionBtn")
    .addEventListener(
      "click",
      () => {

        const action =
          modalAction;


        closeModal();


        if (action) {
          action();
        }

      }
    );


  $$("[data-close-modal]")
    .forEach(
      button => {

        button.addEventListener(
          "click",
          closeModal
        );

      }
    );


  document.addEventListener(
    "keydown",
    event => {

      if (
        event.key ===
        "Escape"
      ) {

        closeModal();

      }

    }
  );

}


// =====================================================
// INICIAR APP DESDE CLOUD.JS
// =====================================================
//
// cloud.js llama a esta función
// después de comprobar que la cuenta
// tiene permiso para entrar.
//
// =====================================================

window.startAccordApp =
  function (
    cloudData
  ) {

    const loadedData =
      validateData(
        cloudData
      );


    state =
      loadedData;


    savedSnapshot =
      JSON.stringify(
        state
      );


    cart =
      [];


    selectedProductId =
      "";


    search =
      "";


    if (
      !appStarted
    ) {

      bind();

      appStarted =
        true;

    }


    clearForms();

    render();

    renderCart();

    nav(
      "dashboard"
    );

  };


// =====================================================
// RECIBIR CAMBIOS DE OTRA COMPUTADORA
// =====================================================
//
// cloud.js llama a esta función:
// - al tocar "Actualizar"
// - al volver a la pestaña
// - automáticamente cada 20 segundos
//
// =====================================================

window.acceptCloudUpdate =
  function (
    cloudData
  ) {

    const updated =
      validateData(
        cloudData
      );


    const newSnapshot =
      JSON.stringify(
        updated
      );


    // No hacer nada si no cambió.

    if (
      newSnapshot ===
      savedSnapshot
    ) {

      return;

    }


    state =
      updated;


    savedSnapshot =
      newSnapshot;


    // Revisamos el carrito
    // por si desde otra PC cambió
    // el stock o se eliminó
    // algún producto.

    syncCartWithState();


    render();

    renderCart();


    // Si había un producto
    // seleccionado para vender,
    // actualizar su información.

    if (
      selectedProductId
    ) {

      const product =
        productById(
          selectedProductId
        );


      if (product) {

        $("#selectedSaleProductName")
          .textContent =
            product.name;


        $("#selectedSaleProductInfo")
          .textContent =
            `Código: ${product.code} · Stock disponible: ${product.stock}`;


        $("#selectedSaleProductPrice")
          .textContent =
            money(
              product.price
            );


        $("#addProductToSale")
          .disabled =
            product.stock < 1;

      }

    }


    toast(
      "Datos actualizados desde la nube."
    );

  };


// =====================================================
// FIN DEL APP.JS
// =====================================================