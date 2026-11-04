export type { User } from "./api";

export interface Product {
  id: string;
  name: string;
  price: number;
  stock: number;
  description: string;
}

export interface OrderUpdate {
  status: string;
  progressPercentage: number;
  time: string;
}
