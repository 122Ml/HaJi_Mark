import { useSearchParams } from "react-router-dom";

// Shareable selection/filter state belongs in the URL; editor drafts stay separate.
export function useLocationValue(key: string, fallback = "") {
  const [params,setParams] = useSearchParams();
  return [params.get(key) ?? fallback, (value:string) => setParams(p=>{
    const next=new URLSearchParams(p);
    value ? next.set(key,value) : next.delete(key);
    if (key !== "page") next.delete("page");
    return next;
  }, {replace:true})] as const;
}

export function useLocationPage(key = "page") {
  const [value,setValue] = useLocationValue(key,"1");
  const page = Number(value);
  return [Number.isInteger(page) && page > 0 ? page : 1, (next:number)=>setValue(String(next))] as const;
}
