resource "aws_vpc" "main" {
  cidr_block           = var.vpc_cidr
  enable_dns_support   = true
  enable_dns_hostnames = true
  tags                 = { Name = local.name }
}

# Three tiers per zone: public (load balancer, NAT), app (containers) and data (databases, cache, broker).
locals {
  az_index = { for i, az in var.availability_zones : az => i }
}

resource "aws_subnet" "public" {
  for_each          = local.az_index
  vpc_id            = aws_vpc.main.id
  availability_zone = each.key
  cidr_block        = cidrsubnet(var.vpc_cidr, 8, each.value)
  tags              = { Name = "${local.name}-public-${each.key}", Tier = "public" }
}

resource "aws_subnet" "app" {
  for_each          = local.az_index
  vpc_id            = aws_vpc.main.id
  availability_zone = each.key
  cidr_block        = cidrsubnet(var.vpc_cidr, 8, 10 + each.value)
  tags              = { Name = "${local.name}-app-${each.key}", Tier = "app" }
}

resource "aws_subnet" "data" {
  for_each          = local.az_index
  vpc_id            = aws_vpc.main.id
  availability_zone = each.key
  cidr_block        = cidrsubnet(var.vpc_cidr, 8, 20 + each.value)
  tags              = { Name = "${local.name}-data-${each.key}", Tier = "data" }
}

resource "aws_internet_gateway" "main" {
  vpc_id = aws_vpc.main.id
  tags   = { Name = local.name }
}

resource "aws_route_table" "public" {
  vpc_id = aws_vpc.main.id
  tags   = { Name = "${local.name}-public" }
}

resource "aws_route" "public_internet" {
  route_table_id         = aws_route_table.public.id
  destination_cidr_block = "0.0.0.0/0"
  gateway_id             = aws_internet_gateway.main.id
}

resource "aws_route_table_association" "public" {
  for_each       = aws_subnet.public
  subnet_id      = each.value.id
  route_table_id = aws_route_table.public.id
}

# Containers reach the internet (to deliver webhooks, to pull images) only through NAT gateways.
locals {
  nat_zones = var.nat_gateway_per_az ? var.availability_zones : [var.availability_zones[0]]
}

resource "aws_eip" "nat" {
  for_each = toset(local.nat_zones)
  domain   = "vpc"
  tags     = { Name = "${local.name}-nat-${each.key}" }
}

resource "aws_nat_gateway" "main" {
  for_each      = toset(local.nat_zones)
  allocation_id = aws_eip.nat[each.key].id
  subnet_id     = aws_subnet.public[each.key].id
  tags          = { Name = "${local.name}-${each.key}" }
  depends_on    = [aws_internet_gateway.main]
}

resource "aws_route_table" "app" {
  for_each = local.az_index
  vpc_id   = aws_vpc.main.id
  tags     = { Name = "${local.name}-app-${each.key}" }
}

resource "aws_route" "app_internet" {
  for_each               = local.az_index
  route_table_id         = aws_route_table.app[each.key].id
  destination_cidr_block = "0.0.0.0/0"
  nat_gateway_id         = aws_nat_gateway.main[var.nat_gateway_per_az ? each.key : var.availability_zones[0]].id
}

resource "aws_route_table_association" "app" {
  for_each       = aws_subnet.app
  subnet_id      = each.value.id
  route_table_id = aws_route_table.app[each.key].id
}

# The data tier has no route to the internet at all.
resource "aws_route_table" "data" {
  vpc_id = aws_vpc.main.id
  tags   = { Name = "${local.name}-data" }
}

resource "aws_route_table_association" "data" {
  for_each       = aws_subnet.data
  subnet_id      = each.value.id
  route_table_id = aws_route_table.data.id
}
