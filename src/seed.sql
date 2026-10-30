-- ============================================================================
-- Sample data (Appendix I, section A1.3 of the project report).
-- Account numbers are assigned explicitly so that they match the report:
-- 1000100001 .. 1000100005.
-- ============================================================================

INSERT INTO branches (branch_name, ifsc_code, city, phone) VALUES
 ('Coimbatore Main', 'SAMP0000001', 'Coimbatore', '0422000001'),
 ('Arasur Branch',   'SAMP0000002', 'Coimbatore', '0422000002');

INSERT INTO employees (branch_id, emp_name, designation, email, hire_date) VALUES
 (1, 'Sample Employee One', 'Manager',    'emp1@example.com', '2020-06-01'),
 (2, 'Sample Employee Two', 'Bank Clerk', 'emp2@example.com', '2022-01-10');

INSERT INTO customers
 (first_name, last_name, date_of_birth, gender, phone, email, id_proof_no, address) VALUES
 ('Asha',   'Kumar',   '1998-04-12', 'F', '9000000001', 'asha@example.com',   'ID-0001', 'Sample Address 1, Coimbatore'),
 ('Ravi',   'Shankar', '1995-09-30', 'M', '9000000002', 'ravi@example.com',   'ID-0002', 'Sample Address 2, Coimbatore'),
 ('Meena',  'Devi',    '2000-01-25', 'F', '9000000003', 'meena@example.com',  'ID-0003', 'Sample Address 3, Arasur'),
 ('Karthik','Raj',     '1992-11-05', 'M', '9000000004', 'karthik@example.com','ID-0004', 'Sample Address 4, Arasur');

INSERT INTO accounts (account_no, customer_id, branch_id, account_type) VALUES
 (1000100001, 1, 1, 'SAVINGS'),
 (1000100002, 2, 1, 'SAVINGS'),
 (1000100003, 3, 2, 'SAVINGS'),
 (1000100004, 4, 2, 'CURRENT'),
 (1000100005, 1, 2, 'CURRENT');
