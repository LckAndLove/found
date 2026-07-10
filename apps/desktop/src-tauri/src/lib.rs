use rusqlite::Connection;
use std::fs;
use std::path::PathBuf;
use tauri::Manager;
use lettre::transport::smtp::authentication::Credentials;
use lettre::{Message, SmtpTransport, Transport};
use regex::Regex;
use serde::{Deserialize, Serialize};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .setup(|app| {
      init_db(app.handle())?;
      app.handle().plugin(tauri_plugin_updater::Builder::new().build())?;
      app.handle().plugin(tauri_plugin_process::init())?;
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }
      Ok(())
    })
    .invoke_handler(tauri::generate_handler![
      get_health,
      get_watchlist,
      add_fund,
      delete_fund,
      update_fund_holdings,
      get_fund_detail,
      get_fund_intraday,
      get_market_indices,
      send_mail_notification,
      search_funds
    ])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}

#[derive(Serialize, Deserialize, Clone)]
pub struct WatchlistItem {
  code: String,
  name: Option<String>,
  #[serde(rename = "sortOrder")]
  sort_order: i32,
  #[serde(rename = "holdingShares")]
  holding_shares: Option<f64>,
  #[serde(rename = "costPrice")]
  cost_price: Option<f64>,
  #[serde(rename = "createdAt")]
  created_at: String,
  #[serde(rename = "updatedAt")]
  updated_at: String,
}

fn get_db_path(app_handle: &tauri::AppHandle) -> Result<PathBuf, String> {
  let mut path = app_handle.path().app_data_dir().map_err(|e| e.to_string())?;
  path.pop(); // Remove bundle identifier com.local.netvalueradar
  path.push("净值雷达");
  path.push("data");
  path.push("found.sqlite");
  Ok(path)
}

fn init_db(app_handle: &tauri::AppHandle) -> Result<(), String> {
  let db_path = get_db_path(app_handle)?;
  if let Some(parent) = db_path.parent() {
    fs::create_dir_all(parent).map_err(|e| e.to_string())?;
  }
  let conn = Connection::open(&db_path).map_err(|e| e.to_string())?;
  conn.execute(
    "CREATE TABLE IF NOT EXISTS fund_watchlist (
        code TEXT PRIMARY KEY CHECK (length(code) = 6),
        name TEXT,
        sort_order INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        holding_shares REAL DEFAULT NULL,
        cost_price REAL DEFAULT NULL
    );",
    [],
  ).map_err(|e| e.to_string())?;
  conn.execute(
    "CREATE INDEX IF NOT EXISTS idx_fund_watchlist_sort_order ON fund_watchlist (sort_order, created_at);",
    [],
  ).map_err(|e| e.to_string())?;
  Ok(())
}

fn find_config_upwards(filename: &str, app_handle: &tauri::AppHandle) -> Option<PathBuf> {
  if let Ok(exe_path) = std::env::current_exe() {
    let mut dir = exe_path.parent();
    while let Some(d) = dir {
      let path = d.join(filename);
      if path.exists() {
        return Some(path);
      }
      dir = d.parent();
    }
  }
  if let Ok(cwd) = std::env::current_dir() {
    let mut dir = Some(cwd.as_path());
    while let Some(d) = dir {
      let path = d.join(filename);
      if path.exists() {
        return Some(path);
      }
      dir = d.parent();
    }
  }
  if let Ok(home) = app_handle.path().home_dir() {
    let path1 = home.join(".config").join("netvalueradar").join(filename);
    if path1.exists() {
      return Some(path1);
    }
    let path2 = home.join("Library").join("Application Support").join("净值雷达").join(filename);
    if path2.exists() {
      return Some(path2);
    }
  }
  None
}

// Helper to strip HTML tags
fn strip_html(html: &str) -> String {
  let re = Regex::new(r"<[^>]+>").unwrap();
  re.replace_all(html, "").trim().to_string()
}

// Helper to parse cell contents from HTML row
fn extract_cells(row_html: &str, tag: &str) -> Vec<String> {
  let cell_pattern = format!(r"(?i)<{}[^>]*>([\s\S]*?)</{}>", tag, tag);
  let re = Regex::new(&cell_pattern).unwrap();
  re.captures_iter(row_html)
    .map(|cap| cap.get(1).map_or("", |m| m.as_str()).to_string())
    .collect()
}

// Suggestion parser helper
fn parse_jsonp(text: &str, callback: &str) -> Option<serde_json::Value> {
  let prefix = format!("{}(", callback);
  let mut trimmed = text.trim();
  if trimmed.ends_with(';') {
    trimmed = &trimmed[..trimmed.len() - 1].trim();
  }
  if trimmed.starts_with(&prefix) && trimmed.ends_with(')') {
    let json_str = &trimmed[prefix.len()..trimmed.len() - 1];
    serde_json::from_str(json_str).ok()
  } else {
    serde_json::from_str(trimmed).ok()
  }
}

// ---------------- TAURI COMMANDS ----------------

#[tauri::command]
fn get_health() -> serde_json::Value {
  serde_json::json!({
    "ok": true,
    "name": "net-value-radar",
    "service": "tauri",
    "timestamp": chrono::Utc::now().to_rfc3339()
  })
}

#[tauri::command]
fn get_watchlist(app_handle: tauri::AppHandle) -> Result<Vec<WatchlistItem>, String> {
  let db_path = get_db_path(&app_handle)?;
  let conn = Connection::open(&db_path).map_err(|e| e.to_string())?;
  let mut stmt = conn
    .prepare("SELECT code, name, sort_order, holding_shares, cost_price, created_at, updated_at FROM fund_watchlist ORDER BY sort_order ASC, created_at ASC")
    .map_err(|e| e.to_string())?;
  let rows = stmt.query_map([], |row| {
    Ok(WatchlistItem {
      code: row.get(0)?,
      name: row.get(1)?,
      sort_order: row.get(2)?,
      holding_shares: row.get(3)?,
      cost_price: row.get(4)?,
      created_at: row.get(5)?,
      updated_at: row.get(6)?,
    })
  }).map_err(|e| e.to_string())?;

  let mut items = Vec::new();
  for r in rows {
    items.push(r.map_err(|e| e.to_string())?);
  }
  Ok(items)
}

#[tauri::command]
fn add_fund(app_handle: tauri::AppHandle, code: String, name: String) -> Result<WatchlistItem, String> {
  let db_path = get_db_path(&app_handle)?;
  let conn = Connection::open(&db_path).map_err(|e| e.to_string())?;
  let max_sort: i32 = conn.query_row(
    "SELECT COALESCE(MAX(sort_order), -1) FROM fund_watchlist",
    [],
    |row| row.get(0),
  ).unwrap_or(-1);

  conn.execute(
    "INSERT OR IGNORE INTO fund_watchlist (code, name, sort_order) VALUES (?, ?, ?)",
    (&code, &name, max_sort + 1),
  ).map_err(|e| e.to_string())?;

  let item = conn.query_row(
    "SELECT code, name, sort_order, holding_shares, cost_price, created_at, updated_at FROM fund_watchlist WHERE code = ?",
    [&code],
    |row| {
      Ok(WatchlistItem {
        code: row.get(0)?,
        name: row.get(1)?,
        sort_order: row.get(2)?,
        holding_shares: row.get(3)?,
        cost_price: row.get(4)?,
        created_at: row.get(5)?,
        updated_at: row.get(6)?,
      })
    },
  ).map_err(|e| e.to_string())?;

  Ok(item)
}

#[tauri::command]
fn delete_fund(app_handle: tauri::AppHandle, code: String) -> Result<(), String> {
  let db_path = get_db_path(&app_handle)?;
  let conn = Connection::open(&db_path).map_err(|e| e.to_string())?;
  conn.execute("DELETE FROM fund_watchlist WHERE code = ?", [&code]).map_err(|e| e.to_string())?;
  Ok(())
}

#[tauri::command]
fn update_fund_holdings(
  app_handle: tauri::AppHandle,
  code: String,
  holding_shares: Option<f64>,
  cost_price: Option<f64>,
) -> Result<WatchlistItem, String> {
  let db_path = get_db_path(&app_handle)?;
  let conn = Connection::open(&db_path).map_err(|e| e.to_string())?;
  conn.execute(
    "UPDATE fund_watchlist SET holding_shares = ?, cost_price = ?, updated_at = datetime('now') WHERE code = ?",
    (holding_shares, cost_price, &code),
  ).map_err(|e| e.to_string())?;

  let item = conn.query_row(
    "SELECT code, name, sort_order, holding_shares, cost_price, created_at, updated_at FROM fund_watchlist WHERE code = ?",
    [&code],
    |row| {
      Ok(WatchlistItem {
        code: row.get(0)?,
        name: row.get(1)?,
        sort_order: row.get(2)?,
        holding_shares: row.get(3)?,
        cost_price: row.get(4)?,
        created_at: row.get(5)?,
        updated_at: row.get(6)?,
      })
    },
  ).map_err(|e| e.to_string())?;

  Ok(item)
}

// ---------------- HTTP DATA CLIENT IMPLEMENTATION ----------------

#[derive(Serialize, Deserialize)]
pub struct FundSearchItem {
  code: String,
  name: String,
  #[serde(rename = "shortName")]
  short_name: Option<String>,
  #[serde(rename = "type")]
  fund_type: Option<String>,
  category: Option<serde_json::Value>,
  #[serde(rename = "categoryDesc")]
  category_desc: Option<String>,
}

#[derive(Serialize, Deserialize)]
pub struct FundHolding {
  code: String,
  name: String,
  weight: String,
  change: Option<f64>,
}

#[derive(Serialize, Deserialize)]
pub struct FundTrendPoint {
  x: f64,
  y: f64,
  #[serde(rename = "equityReturn")]
  equity_return: Option<f64>,
}

#[derive(Serialize, Deserialize)]
pub struct FundDetail {
  code: String,
  name: String,
  dwjz: Option<String>,
  gsz: Option<String>,
  gztime: Option<String>,
  jzrq: Option<String>,
  gszzl: Option<serde_json::Value>,
  zzl: Option<f64>,
  #[serde(rename = "noValuation")]
  no_valuation: bool,
  holdings: Vec<FundHolding>,
  #[serde(rename = "historyTrend")]
  history_trend: Vec<FundTrendPoint>,
  #[serde(rename = "yesterdayChange")]
  yesterday_change: Option<f64>,
  sgzt: Option<String>,
}

// Tencent quote symbols builder
fn to_tencent_symbol(code: &str) -> Option<String> {
  if code.len() == 6 && code.chars().all(|c| c.is_ascii_digit()) {
    if code.starts_with("920") || code.starts_with('4') || code.starts_with('8') {
      Some(format!("s_bj{}", code))
    } else if code.starts_with('6') || code.starts_with('9') {
      Some(format!("s_sh{}", code))
    } else {
      Some(format!("s_sz{}", code))
    }
  } else if code.len() == 5 && code.chars().all(|c| c.is_ascii_digit()) {
    Some(format!("s_hk{}", code))
  } else {
    None
  }
}

#[tauri::command]
async fn get_fund_detail(code: String) -> Result<FundDetail, String> {
  let client = reqwest::Client::new();
  
  // 1. Fetch valuation (fundgz)
  let val_url = format!("https://fundgz.1234567.com.cn/js/{}.js?rt={}", code, chrono::Utc::now().timestamp());
  let mut name = String::new();
  let mut dwjz = None;
  let mut gsz = None;
  let mut gztime = None;
  let mut jzrq = None;
  let mut gszzl = None;
  
  if let Ok(res) = client.get(&val_url).send().await {
    if let Ok(text) = res.text().await {
      if let Some(payload) = parse_jsonp(&text, "jsonpgz") {
        name = payload.get("name").and_then(|v| v.as_str()).unwrap_or("").to_string();
        dwjz = payload.get("dwjz").and_then(|v| v.as_str()).map(|s| s.to_string());
        gsz = payload.get("gsz").and_then(|v| v.as_str()).map(|s| s.to_string());
        gztime = payload.get("gztime").and_then(|v| v.as_str()).map(|s| s.to_string());
        jzrq = payload.get("jzrq").and_then(|v| v.as_str()).map(|s| s.to_string());
        if let Some(val) = payload.get("gszzl") {
          gszzl = Some(val.clone());
        }
      }
    }
  }

  // 2. Fetch Tencent Quote fallback and perform data fusion
  let mut settled_zzl = None;
  let tencent_url = format!("https://qt.gtimg.cn/q=jj{}", code);
  if let Ok(res) = client.get(&tencent_url).send().await {
    if let Ok(text) = res.text().await {
      let var_prefix = format!("v_jj{}=", code);
      if let Some(pos) = text.find(&var_prefix) {
        let content_start = pos + var_prefix.len();
        let raw_val = text[content_start..].trim().trim_matches('"').trim_matches(';');
        let parts: Vec<&str> = raw_val.split('~').collect();
        if parts.len() >= 9 {
          if name.is_empty() {
            name = parts[1].to_string();
          }
          let tencent_date = parts[8].chars().take(10).collect::<String>();
          let tencent_val = parts[5].to_string();
          let t_zzl = parts[7].parse::<f64>().ok();

          let should_update = match &jzrq {
            Some(current_date) => tencent_date >= *current_date,
            None => true,
          };
          if should_update && !tencent_val.is_empty() {
            dwjz = Some(tencent_val);
            jzrq = Some(tencent_date);
            if t_zzl.is_some() {
              settled_zzl = t_zzl;
            }
          }
        }
      }
    }
  }

  if name.is_empty() {
    name = format!("未知基金({})", code);
  }

  // 3. Fetch latest F10 net value details (for sgzt - purchase status & latest net value data fusion)
  let mut sgzt = None;
  let f10_url = format!("https://fundf10.eastmoney.com/F10DataApi.aspx?type=lsjz&code={}&page=1&per=1", code);
  if let Ok(res) = client.get(&f10_url).send().await {
    if let Ok(text) = res.text().await {
      let api_re = Regex::new(r#"content:"([\s\S]*?)""#).unwrap();
      if let Some(cap) = api_re.captures(&text) {
        let raw_html = cap.get(1).map_or("", |m| m.as_str());
        let tr_re = Regex::new(r"(?i)<tr[^>]*>([\s\S]*?)</tr>").unwrap();
        let rows: Vec<&str> = tr_re.find_iter(raw_html).map(|m| m.as_str()).collect();
        if rows.len() > 1 {
          let cells = extract_cells(rows[1], "td");
          if cells.len() >= 5 {
            let f10_date = strip_html(&cells[0]);
            let f10_val = strip_html(&cells[1]);
            let f10_zzl_str = strip_html(&cells[3]).replace('%', "");
            let f10_zzl = f10_zzl_str.parse::<f64>().ok();
            sgzt = Some(strip_html(&cells[4]));

            let should_update = match &jzrq {
              Some(current_date) => f10_date >= *current_date,
              None => true,
            };
            if should_update && !f10_val.is_empty() {
              dwjz = Some(f10_val);
              jzrq = Some(f10_date);
              if f10_zzl.is_some() {
                settled_zzl = f10_zzl;
              }
            }
          }
        }
      }
    }
  }

  // 4. Fetch fund holdings
  let mut holdings = Vec::new();
  let holdings_url = format!("https://fundf10.eastmoney.com/FundArchivesDatas.aspx?type=jjcc&code={}&topline=10", code);
  if let Ok(res) = client.get(&holdings_url).send().await {
    if let Ok(text) = res.text().await {
      let api_re = Regex::new(r#"content:"([\s\S]*?)""#).unwrap();
      if let Some(cap) = api_re.captures(&text) {
        let raw_html = cap.get(1).map_or("", |m| m.as_str());
        let tr_re = Regex::new(r"(?i)<tr[^>]*>([\s\S]*?)</tr>").unwrap();
        let rows: Vec<&str> = tr_re.find_iter(raw_html).map(|m| m.as_str()).collect();
        if rows.len() > 1 {
          let headers = extract_cells(rows[0], "th");
          let mut code_idx = -1;
          let mut name_idx = -1;
          let mut weight_idx = -1;
          for (i, h) in headers.iter().enumerate() {
            let h_clean = h.replace(' ', "");
            if h_clean.contains("代码") { code_idx = i as i32; }
            if h_clean.contains("名称") { name_idx = i as i32; }
            if h_clean.contains("占比") || h_clean.contains("比例") { weight_idx = i as i32; }
          }
          for row in rows.iter().skip(1).take(10) {
            let cells = extract_cells(row, "td");
            if cells.len() > 0 {
              let h_code = if code_idx >= 0 && code_idx < cells.len() as i32 {
                strip_html(&cells[code_idx as usize])
              } else {
                "".to_string()
              };
              let h_name = if name_idx >= 0 && name_idx < cells.len() as i32 {
                strip_html(&cells[name_idx as usize])
              } else {
                "".to_string()
              };
              let h_weight = if weight_idx >= 0 && weight_idx < cells.len() as i32 {
                strip_html(&cells[weight_idx as usize])
              } else {
                "".to_string()
              };
              if !h_code.is_empty() {
                holdings.push(FundHolding {
                  code: h_code,
                  name: h_name,
                  weight: h_weight,
                  change: None,
                });
              }
            }
          }
        }
      }
    }
  }

  // Batch query holding changes from Tencent Quotes
  if holdings.len() > 0 {
    let symbols: Vec<String> = holdings.iter().filter_map(|h| to_tencent_symbol(&h.code)).collect();
    if symbols.len() > 0 {
      let quotes_url = format!("https://qt.gtimg.cn/q={}", symbols.join(","));
      if let Ok(res) = client.get(&quotes_url).send().await {
        if let Ok(text) = res.text().await {
          for h in holdings.iter_mut() {
            if let Some(sym) = to_tencent_symbol(&h.code) {
              let var_name = format!("v_{}=", sym);
              if let Some(idx) = text.find(&var_name) {
                if let Some(start_quote) = text[idx..].find('"') {
                  let absolute_start = idx + start_quote + 1;
                  if let Some(end_quote) = text[absolute_start..].find('"') {
                    let raw_quote = &text[absolute_start..absolute_start + end_quote];
                    let quote_parts: Vec<&str> = raw_quote.split('~').collect();
                    if quote_parts.len() >= 6 {
                      if let Ok(c) = quote_parts[5].parse::<f64>() {
                        h.change = Some(c);
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  }

  // 5. Fetch history trend data (pingzhongdata)
  let mut history_trend = Vec::new();
  let mut yesterday_change = None;
  let trend_url = format!("https://fund.eastmoney.com/pingzhongdata/{}.js?v={}", code, chrono::Utc::now().timestamp());
  if let Ok(res) = client.get(&trend_url).send().await {
    if let Ok(text) = res.text().await {
      let re = Regex::new(r"var Data_netWorthTrend\s*=\s*(\[[\s\S]*?\]);").unwrap();
      if let Some(cap) = re.captures(&text) {
        if let Ok(val) = serde_json::from_str::<serde_json::Value>(&cap[1]) {
          if let Some(arr) = val.as_array() {
            let len = arr.len();
            let skip_count = if len > 90 { len - 90 } else { 0 };
            for item in arr.iter().skip(skip_count) {
              let x = item.get("x").and_then(|v| v.as_f64()).unwrap_or(0.0);
              let y = item.get("y").and_then(|v| v.as_f64()).unwrap_or(0.0);
              let equity_return = item.get("equityReturn").and_then(|v| v.as_f64());
              history_trend.push(FundTrendPoint { x, y, equity_return });
            }
            if history_trend.len() >= 2 {
              yesterday_change = history_trend[history_trend.len() - 2].equity_return;
            }
          }
        }
      }
    }
  }

  let no_valuation = dwjz.is_none() && gsz.is_none();

  Ok(FundDetail {
    code,
    name,
    dwjz,
    gsz,
    gztime,
    jzrq,
    gszzl,
    zzl: settled_zzl,
    no_valuation,
    holdings,
    history_trend,
    yesterday_change,
    sgzt,
  })
}

#[derive(Serialize)]
pub struct IntradayPoint {
  time: String,
  value: f64,
  growth: String,
}

#[derive(Serialize)]
pub struct IntradayResponse {
  code: String,
  date: Option<String>,
  items: Vec<IntradayPoint>,
}

#[tauri::command]
async fn get_fund_intraday(code: String) -> Result<IntradayResponse, String> {
  let client = reqwest::Client::new();
  let url = format!(
    "https://web.ifzq.gtimg.cn/fund/newfund/fundSsgz/getSsgz?app=web&symbol=jj{}&_={}",
    code,
    chrono::Utc::now().timestamp_millis()
  );

  let res = client.get(&url).send().await.map_err(|e| e.to_string())?;
  let payload = res.json::<serde_json::Value>().await.map_err(|e| e.to_string())?;
  
  let res_code = payload.get("code").and_then(|v| v.as_i64()).unwrap_or(-1);
  let data_obj = payload.get("data");
  let yesterday_dwjz = data_obj.and_then(|d| d.get("yesterdayDwjz")).and_then(|v| v.as_str()).and_then(|s| s.parse::<f64>().ok())
    .or_else(|| data_obj.and_then(|d| d.get("yesterdayDwjz")).and_then(|v| v.as_f64()))
    .unwrap_or(0.0);
  let date_text = data_obj.and_then(|d| d.get("date")).and_then(|v| v.as_str()).map(|s| s.to_string());

  let mut items = Vec::new();
  if res_code == 0 && yesterday_dwjz > 0.0 {
    if let Some(arr) = data_obj.and_then(|d| d.get("data")).and_then(|v| v.as_array()) {
      for item in arr {
        if let Some(pt) = item.as_array() {
          if pt.len() >= 2 {
            let time_str = pt[0].as_str().unwrap_or("");
            let value = pt[1].as_str().and_then(|s| s.parse::<f64>().ok())
              .or_else(|| pt[1].as_f64())
              .unwrap_or(0.0);
            if time_str.len() == 4 && value > 0.0 {
              let formatted_time = format!("{}:{}", &time_str[0..2], &time_str[2..4]);
              let growth = format!("{:.2}", ((value - yesterday_dwjz) / yesterday_dwjz) * 100.0);
              items.push(IntradayPoint {
                time: formatted_time,
                value,
                growth,
              });
            }
          }
        }
      }
    }
  }

  Ok(IntradayResponse {
    code,
    date: date_text,
    items,
  })
}

#[derive(Serialize)]
pub struct MarketIndex {
  name: String,
  value: f64,
  change: f64,
  ratio: f64,
}

#[tauri::command]
async fn get_market_indices() -> Result<Vec<MarketIndex>, String> {
  let client = reqwest::Client::new();
  let symbols = [
    "s_sh000001",
    "s_sh000016",
    "s_sz399300",
    "s_sh000905",
    "s_sh000852",
    "s_sh000510",
    "s_sz399001",
    "s_sz399004",
    "s_sz399006",
    "s_sh000688",
  ].join(",");

  let url = format!("https://qt.gtimg.cn/q={}&_t={}", symbols, chrono::Utc::now().timestamp());
  let res = client.get(&url).send().await.map_err(|e| e.to_string())?;
  let text = res.text().await.map_err(|e| e.to_string())?;
  
  let name_map = [
    ("sh000001", "上证指数"),
    ("sh000016", "上证50"),
    ("sz399300", "沪深300"),
    ("sh000300", "沪深300"),
    ("sh000905", "中证500"),
    ("sh000852", "中证1000"),
    ("sh000510", "中证A500"),
    ("sz399001", "深证成指"),
    ("sz399004", "深证100"),
    ("sz399006", "创业板指"),
    ("sh000688", "科创50"),
  ];

  let mut indices = Vec::new();
  for line in text.lines() {
    if let Some(eq_idx) = line.find('=') {
      let val_str = line[eq_idx + 1..].replace('"', "").replace(';', "").trim().to_string();
      let parts: Vec<&str> = val_str.split('~').collect();
      if parts.len() >= 6 {
        let mut name = parts[1].to_string();
        for &(k, n) in name_map.iter() {
          if line.contains(k) {
            name = n.to_string();
            break;
          }
        }
        let value = parts[3].parse::<f64>().unwrap_or(0.0);
        let change = parts[4].parse::<f64>().unwrap_or(0.0);
        let ratio = parts[5].parse::<f64>().unwrap_or(0.0);
        indices.push(MarketIndex {
          name,
          value,
          change,
          ratio,
        });
      }
    }
  }

  Ok(indices)
}

#[tauri::command]
async fn send_mail_notification(
  app_handle: tauri::AppHandle,
  subject: String,
  funds: Vec<serde_json::Value>,
  total_daily_profit: String,
) -> Result<serde_json::Value, String> {
  let mut self_email = std::env::var("FOUND_SMTP_TO").or_else(|_| std::env::var("SMTP_TO")).unwrap_or_else(|_| "your_qq@qq.com".to_string());
  
  // 1. 读取 Google SMTP 配置
  let mut smtp_user = std::env::var("FOUND_SMTP_USER").or_else(|_| std::env::var("SMTP_USER")).unwrap_or_default();
  let mut smtp_pass = std::env::var("FOUND_SMTP_PASS").or_else(|_| std::env::var("SMTP_PASS")).unwrap_or_default();

  if smtp_user.is_empty() || smtp_pass.is_empty() || self_email == "your_qq@qq.com" {
    if let Some(config_path) = find_config_upwards("config/mail.config.json", &app_handle) {
      if let Ok(content) = fs::read_to_string(config_path) {
        if let Ok(json) = serde_json::from_str::<serde_json::Value>(&content) {
          if let Some(u) = json.get("user").and_then(|v| v.as_str()) {
            smtp_user = u.to_string();
          }
          if let Some(p) = json.get("pass").and_then(|v| v.as_str()) {
            smtp_pass = p.to_string();
          }
          if let Some(t) = json.get("to").and_then(|v| v.as_str()) {
            self_email = t.to_string();
          }
        }
      }
    }
  }

  if smtp_user.is_empty() || smtp_pass.is_empty() {
    return Err("SMTP 凭证缺失。请在 config/mail.config.json 中配置您的 Gmail 账号与应用专用密码，或设置 FOUND_SMTP_USER 与 FOUND_SMTP_PASS 环境变量。".to_string());
  }

  // 2. 生成 HTML 邮件模版
  let mut fund_rows = String::new();
  for f in funds {
    let name = f.get("name").and_then(|v| v.as_str()).unwrap_or("");
    let code = f.get("code").and_then(|v| v.as_str()).unwrap_or("");
    let zzl = f.get("zzl").and_then(|v| v.as_str()).unwrap_or("0.00%");
    let zzl_raw = f.get("zzlRaw").and_then(|v| v.as_f64()).unwrap_or(0.0);
    let daily_profit = f.get("dailyProfit").and_then(|v| v.as_str());
    let is_settled = f.get("isSettled").and_then(|v| v.as_bool()).unwrap_or(false);

    let up = zzl_raw > 0.0;
    let dn = zzl_raw < 0.0;
    let r_c = if up { "#d93025" } else if dn { "#188038" } else { "#5f6368" };
    let r_b = if up { "#fce8e6" } else if dn { "#e6f4ea" } else { "#f1f3f4" };
    
    let p_c = if let Some(p) = daily_profit {
      if p.starts_with('+') { "#d93025" } else if p.starts_with('-') { "#188038" } else { "#5f6368" }
    } else {
      "#5f6368"
    };

    let status_badge = if is_settled {
      "<span style=\"display:inline-block;font-size:10px;font-weight:700;color:#188038;background:#e6f4ea;padding:1px 4px;border-radius:4px;margin-left:6px;vertical-align:middle;white-space:nowrap;\">已更新</span>"
    } else {
      "<span style=\"display:inline-block;font-size:10px;font-weight:700;color:#5f6368;background:#f1f3f4;padding:1px 4px;border-radius:4px;margin-left:6px;vertical-align:middle;white-space:nowrap;\">估算中</span>"
    };

    let profit_text = daily_profit.map(|p| format!("&yen;&nbsp;{}", p)).unwrap_or_else(|| "&mdash;".to_string());

    fund_rows.push_str(&format!(
      "<tr><td style=\"padding:12px 16px;border-bottom:1px solid #e9ecef;max-width:260px;\"><div style=\"font-size:13px;font-weight:600;color:#202124;margin-bottom:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;\">{}</div><div style=\"font-size:11px;color:#5f6368;font-family:monospace;\"><span style=\"vertical-align:middle;\">{}</span>{}</div></td><td style=\"padding:12px 16px;border-bottom:1px solid #e9ecef;text-align:center;white-space:nowrap;\"><span style=\"display:inline-block;padding:4px 10px;border-radius:6px;font-size:12px;font-weight:700;background:{};color:{};\">{}</span></td><td style=\"padding:12px 16px;border-bottom:1px solid #e9ecef;text-align:right;font-family:monospace;font-size:13px;font-weight:700;color:{};white-space:nowrap;\">{}</td></tr>",
      name, code, status_badge, r_b, r_c, zzl, p_c, profit_text
    ));
  }

  let t_c = if total_daily_profit.starts_with('+') { "#d93025" } else if total_daily_profit.starts_with('-') { "#188038" } else { "#5f6368" };
  let t_b = if total_daily_profit.starts_with('+') { "#fce8e6" } else if total_daily_profit.starts_with('-') { "#e6f4ea" } else { "#f1f3f4" };
  let t_border = if total_daily_profit.starts_with('+') { "#fad2cf" } else if total_daily_profit.starts_with('-') { "#ceead6" } else { "#e8eaed" };
  
  let now = chrono::Local::now().format("%Y年%m月%d日 %H:%M").to_string();

  let html = format!(
    "<!DOCTYPE html><html lang=\"zh-CN\"><head><meta charset=\"UTF-8\"></head><body style=\"margin:0;padding:0;background:#f5f7f8;color:#202124;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;\"><table width=\"100%\" cellpadding=\"0\" cellspacing=\"0\" style=\"background:#f5f7f8;padding:32px 16px;\"><tr><td align=\"center\"><table width=\"600\" cellpadding=\"0\" cellspacing=\"0\" style=\"max-width:600px;width:100%;\"><tr><td style=\"background:#ffffff;border-radius:16px 16px 0 0;padding:32px 40px;border-bottom:1px solid #e9ecef;border-top:4px solid #1a73e8;\"><div style=\"color:#5f6368;font-size:11px;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;\">NET VALUE RADAR</div><div style=\"color:#202124;font-size:22px;font-weight:800;letter-spacing:-0.03em;margin-top:6px;\">净值雷达</div><div style=\"margin-top:16px;color:#5f6368;font-size:13px;\">今日净值已全部更新 &nbsp;·&nbsp; {}</div></td></tr><tr><td style=\"background:#ffffff;padding:28px 40px 8px;\"><table width=\"100%\" cellpadding=\"0\" cellspacing=\"0\" style=\"background:{};border-radius:14px;padding:0;border:1px solid {};\"><tr><td style=\"padding:20px 24px;\"><div style=\"font-size:11px;font-weight:700;color:#5f6368;letter-spacing:0.08em;text-transform:uppercase;margin-bottom:6px;\">今日估算总收益</div><div style=\"font-size:30px;font-weight:800;color:{};letter-spacing:-0.02em;\">&#165; {}</div></td></tr></table></td></tr><tr><td style=\"background:#ffffff;padding:20px 40px 28px;\"><div style=\"font-size:11px;font-weight:700;color:#5f6368;letter-spacing:0.08em;text-transform:uppercase;margin-bottom:12px;\">自选基金明细</div><table width=\"100%\" cellpadding=\"0\" cellspacing=\"0\" style=\"border-collapse:collapse;border:1px solid #e9ecef;border-radius:12px;overflow:hidden;\"><thead><tr style=\"background:#f8f9fa;\"><th style=\"padding:10px 16px;text-align:left;font-size:11px;font-weight:700;color:#5f6368;letter-spacing:0.05em;border-bottom:1px solid #e9ecef;\">基金名称</th><th style=\"padding:10px 16px;text-align:center;font-size:11px;font-weight:700;color:#5f6368;border-bottom:1px solid #e9ecef;\">涨跌幅</th><th style=\"padding:10px 16px;text-align:right;font-size:11px;font-weight:700;color:#5f6368;border-bottom:1px solid #e9ecef;\">估算收益</th></tr></thead><tbody>{}</tbody></table></td></tr><tr><td style=\"background:#ffffff;border-radius:0 0 16px 16px;padding:16px 40px 28px;border-top:1px solid #e9ecef;text-align:center;\"><div style=\"color:#9aa0a6;font-size:12px;line-height:1.8;\">此邮件由 <strong style=\"color:#5f6368;\">净值雷达</strong> 自动发送 &nbsp;·&nbsp; 数据来源天天基金<br>仅供参考，不构成投资建议</div></td></tr></table></td></tr></table></body></html>",
    now, t_b, t_border, t_c, total_daily_profit, fund_rows
  );

  // 3. 发送邮件
  let email = Message::builder()
    .from(format!("\"净值雷达\" <{}>", smtp_user).parse().map_err(|e| format!("From address parse error: {}", e))?)
    .to(self_email.parse().map_err(|e| format!("To address parse error: {}", e))?)
    .subject(&subject)
    .header(lettre::message::header::ContentType::TEXT_HTML)
    .body(html)
    .map_err(|e| format!("Message building error: {}", e))?;

  let creds = Credentials::new(smtp_user, smtp_pass);
  let mailer = SmtpTransport::relay("smtp.gmail.com")
    .map_err(|e| format!("Relay configuration error: {}", e))?
    .credentials(creds)
    .build();

  mailer.send(&email).map_err(|e| format!("SMTP send failed: {}", e))?;

  Ok(serde_json::json!({
    "ok": true,
    "to": self_email,
    "method": "smtp"
  }))
}

#[tauri::command]
async fn search_funds(keyword: String) -> Result<serde_json::Value, String> {
  let client = reqwest::Client::new();
  let callback = format!("SuggestData_{}", chrono::Utc::now().timestamp_millis());
  let url = format!(
    "https://fundsuggest.eastmoney.com/FundSearch/api/FundSearchAPI.ashx?m=1&key={}&callback={}&_={}",
    keyword,
    callback,
    chrono::Utc::now().timestamp_millis()
  );

  let res = client.get(&url).send().await.map_err(|e| e.to_string())?;
  let text = res.text().await.map_err(|e| e.to_string())?;
  
  if let Some(payload) = parse_jsonp(&text, &callback) {
    if let Some(datas) = payload.get("Datas") {
      let mut items = Vec::new();
      if let Some(arr) = datas.as_array() {
        for item in arr {
          let category = item.get("CATEGORY").and_then(|v| v.as_i64()).unwrap_or(-1);
          let category_desc = item.get("CATEGORYDESC").and_then(|v| v.as_str()).unwrap_or("");
          if category == 700 || category_desc == "基金" {
            let code = item.get("CODE").and_then(|v| v.as_str()).unwrap_or("").to_string();
            let name = item.get("NAME").and_then(|v| v.as_str())
              .or_else(|| item.get("SHORTNAME").and_then(|v| v.as_str()))
              .unwrap_or("").to_string();
            if !code.is_empty() && !name.is_empty() {
              items.push(serde_json::json!({
                "code": code,
                "name": name,
                "shortName": item.get("SHORTNAME").and_then(|v| v.as_str()),
                "type": item.get("TYPE").and_then(|v| v.as_str()),
                "category": category,
                "categoryDesc": category_desc
              }));
            }
          }
        }
      }
      return Ok(serde_json::json!({ "items": items }));
    }
  }

  Ok(serde_json::json!({ "items": [] }))
}
