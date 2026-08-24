use std::{
    cell::RefCell,
    collections::{HashMap, HashSet},
    sync::{Arc, RwLock},
};

use cel_interpreter::{
    extractors::This, objects::Map, Context, ExecutionError, FunctionContext, Program,
    ResolveResult, Value,
};
use chrono::{DateTime, FixedOffset, Local};
use itertools::Itertools;
use once_cell::sync::Lazy;
use process_mining::core::event_data::object_centric::{
    linked_ocel::{
        slim_linked_ocel::{EventIndex, EventOrObjectIndex, InnerIndex, ObjectIndex},
        LinkedOCELAccess, SlimLinkedOCEL,
    },
    OCELAttributeValue,
};

use crate::{
    binding_box::{
        structs::{
            ChildResults, EventVariable, LabelFunction, LabelValue, ObjectVariable, Variable,
        },
        Binding,
    },
    preprocessing::linked_ocel::{event_or_object_from_index, OCELNode},
};

fn string_to_index(s: &str) -> Option<EventOrObjectIndex> {
    // ob_ and ev_ are the prefixes we reserve
    let (typ, num) = s.split_at(3);
    let num = num.parse::<InnerIndex>().ok()?;
    if typ == "ob_" {
        Some(EventOrObjectIndex::Object(num.into()))
    } else if typ == "ev_" {
        Some(EventOrObjectIndex::Event(num.into()))
    } else {
        None
    }
}

struct RawBindingContextPtr<'a, T>(*mut &'a T);

unsafe impl<T> Send for RawBindingContextPtr<'_, T> {}
unsafe impl<T> Sync for RawBindingContextPtr<'_, T> {}
impl<T> Clone for RawBindingContextPtr<'_, T> {
    fn clone(&self) -> Self {
        *self
    }
}

impl<T> Copy for RawBindingContextPtr<'_, T> {}

fn index_string_to_val(s: &str, ocel: &SlimLinkedOCEL) -> Option<OCELNode> {
    let index = string_to_index(s)?;
    let ret = event_or_object_from_index(index, ocel);
    Some(ret)
}

unsafe fn index_string_to_val_raw<'a>(
    s: &str,
    ocel: RawBindingContextPtr<'a, SlimLinkedOCEL>,
) -> Option<OCELNode> {
    index_string_to_val(s, ocel.0.as_ref().unwrap())
}

unsafe fn get_ocel_raw(ocel: RawBindingContextPtr<'_, SlimLinkedOCEL>) -> &SlimLinkedOCEL {
    ocel.0.as_ref().unwrap()
}

pub static CEL_PROGRAM_CACHE: Lazy<RwLock<HashMap<String, Program>>> = Lazy::new(|| {
    let m = HashMap::new();
    RwLock::new(m)
});

pub fn lazy_compile_and_insert_into_cache(cel: &str) -> Result<(), String> {
    let already_in_cache = CEL_PROGRAM_CACHE.read().unwrap().contains_key(cel);
    if !already_in_cache {
        let program = Program::compile(cel).map_err(|e| format!("Failed to compile CEL: {e}"))?;
        let mut w_lock = CEL_PROGRAM_CACHE.write().unwrap();
        w_lock.insert(cel.to_string(), program);
    }
    Ok(())
}

pub fn ev_var_to_name(ev_var: &EventVariable) -> String {
    format!("e{}", ev_var.0 + 1)
}
pub fn ob_var_to_name(ob_var: &ObjectVariable) -> String {
    format!("o{}", ob_var.0 + 1)
}

pub fn ev_index_to_name(ev_index: &EventIndex) -> String {
    format!("ev_{}", ev_index.into_inner())
}
pub fn ob_index_to_name(ob_index: &ObjectIndex) -> String {
    format!("ob_{}", ob_index.into_inner())
}

thread_local! {
    static CEL_BASE_CTX: RefCell<Option<(CelCacheKey, Context<'static>)>> = const { RefCell::new(None) };

    static EV_INDEX_NAME_CACHE: RefCell<Option<IndexNameCache>> = const { RefCell::new(None) };
    static OB_INDEX_NAME_CACHE: RefCell<Option<IndexNameCache>> = const { RefCell::new(None) };
}

struct IndexNameCache {
    key: CelCacheKey,
    names: Vec<Option<Arc<String>>>,
}

#[derive(Clone, Copy, PartialEq, Eq)]
struct CelCacheKey {
    ptr: usize,
    num_evs: usize,
    num_obs: usize,
}

impl CelCacheKey {
    fn from_ocel(ocel: &SlimLinkedOCEL) -> Self {
        Self {
            ptr: ocel as *const _ as usize,
            num_evs: ocel.get_all_evs().count(),
            num_obs: ocel.get_all_obs().count(),
        }
    }
}

fn cached_ev_index_name(idx: &EventIndex, key: CelCacheKey) -> Arc<String> {
    EV_INDEX_NAME_CACHE.with(|cell| {
        let mut slot = cell.borrow_mut();
        let cache = slot.get_or_insert_with(|| IndexNameCache {
            key,
            names: vec![None; key.num_evs],
        });
        if cache.key != key {
            cache.key = key;
            cache.names = vec![None; key.num_evs];
        }
        let inner = idx.into_inner();
        let i = inner as usize;
        if i >= cache.names.len() {
            cache.names.resize(i + 1, None);
        }
        cache.names[i]
            .get_or_insert_with(|| Arc::new(format!("ev_{inner}")))
            .clone()
    })
}

fn cached_ob_index_name(idx: &ObjectIndex, key: CelCacheKey) -> Arc<String> {
    OB_INDEX_NAME_CACHE.with(|cell| {
        let mut slot = cell.borrow_mut();
        let cache = slot.get_or_insert_with(|| IndexNameCache {
            key,
            names: vec![None; key.num_obs],
        });
        if cache.key != key {
            cache.key = key;
            cache.names = vec![None; key.num_obs];
        }
        let inner = idx.into_inner();
        let i = inner as usize;
        if i >= cache.names.len() {
            cache.names.resize(i + 1, None);
        }
        cache.names[i]
            .get_or_insert_with(|| Arc::new(format!("ob_{inner}")))
            .clone()
    })
}

fn build_base_cel_context(ocel: &SlimLinkedOCEL) -> Context<'static> {
    let mut context: Context<'static> = Context::default();

    let ocel_raw = RawBindingContextPtr(unsafe {
        std::mem::transmute::<*mut &SlimLinkedOCEL, *mut &'static SlimLinkedOCEL>(Box::into_raw(
            Box::new(ocel),
        ))
    });

    context.add_function(
        "type",
        move |ftx: &FunctionContext, This(variable): This<Arc<String>>| -> ResolveResult {
            let val = unsafe { index_string_to_val_raw(&variable, ocel_raw) };

            match val {
                Some(val_ref) => {
                    let ocel_type = match val_ref {
                        OCELNode::Event(ev) => ev.event_type,
                        OCELNode::Object(ob) => ob.object_type,
                    };
                    Ok(ocel_type.into())
                }

                None => ftx.error("Event or Object not found.").into(),
            }
        },
    );

    context.add_function("min", |cel_interpreter::extractors::Arguments(args): cel_interpreter::extractors::Arguments| -> Result<Value,ExecutionError> {
            // If items is a list of values, then operate on the list
            let items = if args.len() == 1 {
                match &args[0] {
                    Value::List(values) => values,
                    _ => return Ok(args[0].clone()),
                }
            } else {
                &args
            };
            items
                .iter()
                .skip(1)
                .try_fold(items.first().unwrap_or(&Value::Null), |acc, x| {
                    match acc.partial_cmp(x) {
                        Some(std::cmp::Ordering::Less) => Ok(acc),
                        Some(_) => Ok(x),
                        None => Err(ExecutionError::ValuesNotComparable(acc.clone(), x.clone())),
                    }
                })
                .cloned()
        });

    context.add_function(
        "attr",
        move |ftx: &FunctionContext,
              This(variable): This<Arc<String>>,
              attr_name: Arc<String>|
              -> ResolveResult {
            let val = unsafe { index_string_to_val_raw(&variable, ocel_raw) };
            let res = match val {
                Some(val_ref) => {
                    let attr_val = match val_ref {
                        OCELNode::Event(ev) => ev
                            .attributes
                            .into_iter()
                            .find(|a| &a.name == attr_name.as_ref())
                            .map(|a| a.value),
                        OCELNode::Object(ob) => ob
                            .attributes
                            .into_iter()
                            .find(|a| &a.name == attr_name.as_ref())
                            .map(|a| a.value),
                    }
                    .unwrap_or(OCELAttributeValue::Null);
                    let cel_val = match attr_val {
                        OCELAttributeValue::Float(f) => (f).into(),
                        OCELAttributeValue::Integer(i) => (i).into(),
                        OCELAttributeValue::String(s) => s.into(),
                        OCELAttributeValue::Time(t) => t.fixed_offset().into(),
                        OCELAttributeValue::Boolean(b) => (b).into(),
                        OCELAttributeValue::Null => Value::Null,
                    };
                    Ok(cel_val)
                }

                None => ftx.error("Event or Object not found.").into(),
            };
            res
        },
    );

    context.add_function(
        "attrAt",
        move |ftx: &FunctionContext,
              This(variable): This<Arc<String>>,
              attr_name: Arc<String>,
              at: DateTime<FixedOffset>|
              -> ResolveResult {
            let val = unsafe { index_string_to_val_raw(&variable, ocel_raw) };
            let res = match val {
                Some(val_ref) => {
                    let attr_val = match val_ref {
                        OCELNode::Event(ev) => ev
                            .attributes
                            .into_iter()
                            .find(|a| &a.name == attr_name.as_ref())
                            .map(|a| a.value),
                        OCELNode::Object(ob) => ob
                            .attributes
                            .into_iter()
                            .filter(|a| &a.name == attr_name.as_ref())
                            .sorted_by_key(|a| a.time)
                            .rfind(|a| a.time <= at)
                            .map(|a| a.value),
                    }
                    .unwrap_or(OCELAttributeValue::Null);
                    Ok(ocel_val_to_cel_val(attr_val))
                }

                None => ftx.error("Event or Object not found.").into(),
            };
            res
        },
    );

    context.add_function(
        "id",
        move |ftx: &FunctionContext, This(variable): This<Arc<String>>| -> ResolveResult {
            let val = unsafe { index_string_to_val_raw(&variable, ocel_raw) };

            match val {
                Some(val_ref) => {
                    let attr_val = match val_ref {
                        OCELNode::Event(ev) => ev.id,
                        OCELNode::Object(ob) => ob.id,
                    };
                    Ok(attr_val.into())
                }

                None => ftx.error("Event or Object not found.").into(),
            }
        },
    );

    context.add_function(
        "attrs",
        move |ftx: &FunctionContext, This(variable): This<Arc<String>>| -> ResolveResult {
            let val = unsafe { index_string_to_val_raw(&variable, ocel_raw) };

            match val {
                Some(val_ref) => {
                    let attr_val: Vec<Vec<Value>> = match val_ref {
                        OCELNode::Event(ev) => ev
                            .attributes
                            .into_iter()
                            .map(|a| {
                                vec![
                                    a.name.clone().into(),
                                    ocel_val_to_cel_val(a.value),
                                    Value::Null,
                                ]
                            })
                            .collect(),
                        OCELNode::Object(ob) => ob
                            .attributes
                            .into_iter()
                            .map(|a| {
                                vec![
                                    a.name.clone().into(),
                                    ocel_val_to_cel_val(a.value),
                                    a.time.fixed_offset().into(),
                                ]
                            })
                            .collect(),
                    };
                    Ok(attr_val.into())
                }

                None => ftx.error("Event or Object not found.").into(),
            }
        },
    );

    context.add_function(
        "time",
        move |ftx: &FunctionContext, This(variable): This<Arc<String>>| -> ResolveResult {
            let s = variable.as_str();
            if let Some(rest) = s.strip_prefix("ev_") {
                if let Ok(idx) = rest.parse::<InnerIndex>() {
                    let ocel_ref = unsafe { get_ocel_raw(ocel_raw) };
                    let ev_index: EventIndex = idx.into();
                    return Ok((*ocel_ref.get_ev_time(&ev_index)).into());
                }
            }
            ftx.error("Event not found.").into()
        },
    );

    context.add_function("numEvents", move || -> ResolveResult {
        unsafe { Ok((get_ocel_raw(ocel_raw).get_all_evs().count() as u64).into()) }
    });
    context.add_function("numObjects", move || -> ResolveResult {
        unsafe { Ok((get_ocel_raw(ocel_raw).get_all_obs().count() as u64).into()) }
    });

    context.add_function("events", move || -> ResolveResult {
        unsafe {
            Ok((get_ocel_raw(ocel_raw)
                .get_all_evs()
                .map(|x| ev_index_to_name(&x)))
            .collect_vec()
            .into())
        }
    });

    context.add_function("objects", move || -> ResolveResult {
        unsafe {
            Ok((get_ocel_raw(ocel_raw)
                .get_all_obs()
                .map(|x| ob_index_to_name(&x)))
            .collect_vec()
            .into())
        }
    });

    context.add_function(
        "sum",
        move |_ftx: &FunctionContext, This(variable): This<Arc<Vec<Value>>>| -> ResolveResult {
            Ok(variable.iter().map(value_to_float).sum::<f64>().into())
        },
    );

    context.add_function(
        "avg",
        move |_ftx: &FunctionContext, This(variable): This<Arc<Vec<Value>>>| -> ResolveResult {
            let (count, sum) = variable
                .iter()
                .map(value_to_float)
                .fold((0_usize, 0.0), |(count, sum), f| (count + 1, sum + f));
            Ok((sum / count as f64).into())
        },
    );
    context
}

pub fn evaluate_cel<'a>(
    cel: &str,
    binding: &'a Binding,
    child_res: Option<&ChildResults>,
    ocel: &'a SlimLinkedOCEL,
) -> Result<Value, CELEvalError> {
    lazy_compile_and_insert_into_cache(cel).map_err(CELEvalError::ParseError)?;
    let cache_read = CEL_PROGRAM_CACHE.read().unwrap();
    let p = match cache_read.get(cel) {
        Some(p) => p,
        None => {
            return Err(CELEvalError::ParseError(String::from(
                "Could not parse CEL",
            )))
        }
    };

    let ocel_key = CelCacheKey::from_ocel(ocel);

    CEL_BASE_CTX.with(|cell| {
        let needs_rebuild = cell
            .borrow()
            .as_ref()
            .map(|(k, _)| *k != ocel_key)
            .unwrap_or(true);
        if needs_rebuild {
            *cell.borrow_mut() = Some((ocel_key, build_base_cel_context(ocel)));
        }

        let cached = cell.borrow();
        let base = &cached.as_ref().unwrap().1;

        let mut context = base.new_inner_scope();

        for (e_var, e_index) in binding.event_map.iter() {
            let arc = cached_ev_index_name(e_index, ocel_key);
            context.add_variable_from_value(ev_var_to_name(e_var), Value::String(arc));
        }
        for (o_var, o_index) in binding.object_map.iter() {
            let arc = cached_ob_index_name(o_index, ocel_key);
            context.add_variable_from_value(ob_var_to_name(o_var), Value::String(arc));
        }
        for (label, value) in binding.label_map.iter() {
            context.add_variable_from_value(
                label.clone(),
                Into::<cel_interpreter::Value>::into(value.clone()),
            );
        }
        context.add_variable_from_value("now", Value::Timestamp(Local::now().into()));

        if let Some(child_res) = child_res {
            for (child_name, child_out) in child_res {
                let value: Vec<Value> = child_out
                    .iter()
                    .map(|(b, violated)| {
                        let mut b_map = HashMap::with_capacity(
                            b.event_map.len() + b.object_map.len() + b.label_map.len() + 1,
                        );
                        b_map.extend(b.event_map.iter().map(|(ev_v, ev_i)| {
                            (
                                ev_var_to_name(ev_v).into(),
                                Value::String(cached_ev_index_name(ev_i, ocel_key)),
                            )
                        }));
                        b_map.extend(b.object_map.iter().map(|(ob_v, ob_i)| {
                            (
                                ob_var_to_name(ob_v).into(),
                                Value::String(cached_ob_index_name(ob_i, ocel_key)),
                            )
                        }));
                        b_map.extend(b.label_map.iter().map(|(label, value)| {
                            (
                                label.clone().into(),
                                Into::<cel_interpreter::Value>::into(value.clone()),
                            )
                        }));
                        b_map.insert("satisfied".into(), violated.is_none().into());
                        Value::Map(Map {
                            map: Arc::new(b_map),
                        })
                    })
                    .collect();
                context.add_variable_from_value(child_name.clone(), value)
            }
        }

        Ok(p.execute(&context)?)
    })
}

#[derive(Debug)]
pub enum CELEvalError {
    ExecError(ExecutionError),
    ParseError(String),
}

impl From<ExecutionError> for CELEvalError {
    fn from(value: ExecutionError) -> Self {
        Self::ExecError(value)
    }
}

pub fn check_cel_predicate<'a>(
    cel: &str,
    binding: &'a Binding,
    child_res: Option<&ChildResults>,
    ocel: &'a SlimLinkedOCEL,
) -> Result<bool, String> {
    match evaluate_cel(cel, binding, child_res, ocel) {
        Ok(Value::Bool(b)) => Ok(b),
        Ok(_) => Err("Got non-bool CEL result!".to_string()),
        Err(CELEvalError::ExecError(e)) => Err(e.to_string()),
        Err(CELEvalError::ParseError(e)) => Err(e),
    }
}

pub fn add_cel_label<'a>(
    binding: &'a mut Binding,
    child_res: Option<&ChildResults>,
    ocel: &'a SlimLinkedOCEL,
    label_fun: &'a LabelFunction,
) -> Result<(), String> {
    match evaluate_cel(&label_fun.cel, binding, child_res, ocel) {
        Ok(v) => {
            binding.add_label(label_fun.label.clone(), v.into());
            Ok(())
        }
        Err(e) => {
            binding.add_label(label_fun.label.clone(), LabelValue::Null);
            Err(format!(
                "Error while computing binding label {} with error {e:?}",
                label_fun.label
            ))
        }
    }
}

fn value_to_float(val: &Value) -> f64 {
    match val {
        Value::Int(i) => *i as f64,
        Value::UInt(ui) => *ui as f64,
        Value::Float(f) => *f,
        Value::String(s) => s.parse().unwrap_or_default(),
        _ => 0.0,
    }
}

fn ocel_val_to_cel_val(val: OCELAttributeValue) -> Value {
    match val {
        OCELAttributeValue::Float(f) => f.into(),
        OCELAttributeValue::Integer(i) => i.into(),
        OCELAttributeValue::String(s) => s.into(),
        OCELAttributeValue::Time(t) => t.fixed_offset().into(),
        OCELAttributeValue::Boolean(b) => b.into(),
        OCELAttributeValue::Null => Value::Null,
    }
}
fn string_to_var(s: &str) -> Variable {
    let (typ, num) = s.split_at(1);
    let num = num.parse::<usize>().map(|v| v - 1).unwrap_or_default();
    if typ == "o" {
        Variable::Object(ObjectVariable(num))
    } else {
        Variable::Event(EventVariable(num))
    }
}

pub fn get_vars_in_cel_program(cel: &str) -> HashSet<Variable> {
    if lazy_compile_and_insert_into_cache(cel).is_ok() {
        let r_lock = CEL_PROGRAM_CACHE.read().unwrap();
        let p = r_lock.get(cel).unwrap();
        p.references()
            .variables()
            .into_iter()
            .map(string_to_var)
            .collect()
    } else {
        HashSet::default()
    }
}

impl From<cel_interpreter::Value> for LabelValue {
    fn from(value: cel_interpreter::Value) -> Self {
        match value {
            Value::Int(i) => LabelValue::Int(i),
            Value::UInt(i) => LabelValue::Int(i as i64),
            Value::Float(f) => LabelValue::Float(f.into()),
            Value::String(arc) => LabelValue::String(arc),
            Value::Bool(b) => LabelValue::Bool(b),
            Value::Duration(time_delta) => LabelValue::String(Arc::new(time_delta.to_string())),
            Value::Timestamp(date_time) => LabelValue::String(Arc::new(date_time.to_rfc3339())),
            _ => LabelValue::Null,
        }
    }
}

impl From<LabelValue> for cel_interpreter::Value {
    fn from(val: LabelValue) -> Self {
        match val {
            LabelValue::String(arc) => Value::String(arc),
            LabelValue::Int(i) => Value::Int(i),
            LabelValue::Float(f) => Value::Float(f.into()),
            LabelValue::Bool(b) => Value::Bool(b),
            LabelValue::Null => Value::Null,
        }
    }
}
