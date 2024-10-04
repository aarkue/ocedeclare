// This file was generated by [ts-rs](https://github.com/Aleph-Alpha/ts-rs). Do not edit this file manually.
import type { EventVariable } from "./EventVariable";
import type { ObjectValueFilterTimepoint } from "./ObjectValueFilterTimepoint";
import type { ObjectVariable } from "./ObjectVariable";
import type { ValueFilter } from "./ValueFilter";
import type { Variable } from "./Variable";

export type Filter =
  | {
      type: "O2E";
      object: ObjectVariable;
      event: EventVariable;
      qualifier: string | null;
    }
  | {
      type: "O2O";
      object: ObjectVariable;
      other_object: ObjectVariable;
      qualifier: string | null;
    }
  | {
      type: "TimeBetweenEvents";
      from_event: EventVariable;
      to_event: EventVariable;
      min_seconds: number | null;
      max_seconds: number | null;
    }
  | { type: "NotEqual"; var_1: Variable; var_2: Variable }
  | {
      type: "EventAttributeValueFilter";
      event: EventVariable;
      attribute_name: string;
      value_filter: ValueFilter;
    }
  | {
      type: "ObjectAttributeValueFilter";
      object: ObjectVariable;
      attribute_name: string;
      at_time: ObjectValueFilterTimepoint;
      value_filter: ValueFilter;
    }
  | { type: "BasicFilterCEL"; cel: string };
